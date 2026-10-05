from __future__ import annotations

import asyncio
import runpy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import pandas as pd
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import main  # noqa: E402


class SecurityPolicyContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_cross_origin_preflight_does_not_get_cors_permission(self) -> None:
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://fixture") as client:
            response = await client.options(
                "/api/refresh",
                headers={
                    "Origin": "https://attacker.example",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
        self.assertIsNone(response.headers.get("access-control-allow-origin"))

    async def test_empty_origin_header_is_rejected_before_refresh(self) -> None:
        calls: list[str] = []
        original_update = main.incremental_update
        original_cache = main._df_cache
        main.incremental_update = lambda: calls.append("refresh") or pd.DataFrame()  # type: ignore[assignment]
        try:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost:8509") as client:
                response = await client.post(
                    "/api/refresh",
                    data={"source": "malformed-origin"},
                    headers={"Origin": ""},
                )
        finally:
            main.incremental_update = original_update
            main._df_cache = original_cache
        self.assertEqual(calls, [])
        self.assertEqual(response.status_code, 403)

    async def test_cross_site_form_post_cannot_trigger_refresh(self) -> None:
        calls: list[str] = []
        original_update = main.incremental_update
        original_cache = main._df_cache
        main.incremental_update = lambda: calls.append("refresh") or pd.DataFrame()  # type: ignore[assignment]
        try:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost:8509") as client:
                response = await client.post(
                    "/api/refresh",
                    data={"source": "cross-site-form"},
                    headers={"Origin": "https://attacker.example"},
                )
        finally:
            main.incremental_update = original_update
            main._df_cache = original_cache
        self.assertEqual(calls, [])
        self.assertEqual(response.status_code, 403)

    async def test_cross_site_fetch_metadata_cannot_trigger_refresh_without_origin(self) -> None:
        calls: list[str] = []
        original_update = main.incremental_update
        original_cache = main._df_cache
        main.incremental_update = lambda: calls.append("refresh") or pd.DataFrame()  # type: ignore[assignment]
        try:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost:8509") as client:
                response = await client.post(
                    "/api/refresh",
                    data={"source": "cross-site-form"},
                    headers={"Sec-Fetch-Site": "cross-site"},
                )
        finally:
            main.incremental_update = original_update
            main._df_cache = original_cache
        self.assertEqual(calls, [])
        self.assertEqual(response.status_code, 403)

    async def test_same_origin_form_post_remains_allowed(self) -> None:
        calls: list[str] = []
        original_update = main.incremental_update
        original_cache = main._df_cache
        main.incremental_update = lambda: calls.append("refresh") or pd.DataFrame()  # type: ignore[assignment]
        try:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost:8509") as client:
                response = await client.post(
                    "/api/refresh",
                    data={"source": "same-origin-form"},
                    headers={"Origin": "http://localhost:8509", "Sec-Fetch-Site": "same-origin"},
                )
        finally:
            main.incremental_update = original_update
            main._df_cache = original_cache
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, ["refresh"])

    async def test_non_loopback_host_is_rejected_even_when_origin_matches(self) -> None:
        calls: list[str] = []
        original_update = main.incremental_update
        original_cache = main._df_cache
        main.incremental_update = lambda: calls.append("refresh") or pd.DataFrame()  # type: ignore[assignment]
        try:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://attacker.example:8509") as client:
                response = await client.post(
                    "/api/refresh",
                    data={"source": "dns-rebinding"},
                    headers={"Origin": "http://attacker.example:8509", "Sec-Fetch-Site": "same-origin"},
                )
        finally:
            main.incremental_update = original_update
            main._df_cache = original_cache
        self.assertEqual(calls, [])
        self.assertEqual(response.status_code, 403)

    async def test_cross_origin_unsafe_routes_are_rejected_before_handlers(self) -> None:
        import ml_predictor

        headers = {"Origin": "https://attacker.example", "Sec-Fetch-Site": "cross-site"}
        transport = httpx.ASGITransport(app=main.app)
        with (
            patch.object(main, "get_df", return_value=pd.DataFrame()) as get_df,
            patch.object(main, "add_to_watchlist", return_value={}) as add_watchlist,
            patch.object(main, "remove_from_watchlist", return_value={}) as remove_watchlist,
            patch.object(ml_predictor, "train_model") as train_model,
        ):
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost:8509") as client:
                responses = [
                    await client.post("/api/ml-train?col=top3", data={"go": "1"}, headers=headers),
                    await client.post("/api/watchlist", json={"col": "top3", "number": "001"}, headers=headers),
                    await client.delete("/api/watchlist?col=top3&number=001", headers=headers),
                ]
        self.assertEqual([r.status_code for r in responses], [403, 403, 403])
        get_df.assert_not_called()
        add_watchlist.assert_not_called()
        remove_watchlist.assert_not_called()
        train_model.assert_not_called()

    def test_direct_main_entrypoint_binds_loopback_only(self) -> None:
        calls: list[dict[str, object]] = []
        original_run = uvicorn.run
        uvicorn.run = lambda *args, **kwargs: calls.append(kwargs)  # type: ignore[assignment]
        try:
            runpy.run_path(str(ROOT / "main.py"), run_name="__main__")
        finally:
            uvicorn.run = original_run
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].get("host"), "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
