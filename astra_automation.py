"""Future-only astra automation. Importing this module starts no work.

Only lifespan starts the cooperative worker. The shared file lock and durable
next-check time cover all processes; GET/status never polls or infers.
"""
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
import threading

import astra
from astra_source import OnlineSource, SourceError, validate_draw
from astra_storage import (ERRORS, STATE_DEFAULTS, SnapshotStore, StorageError,
                           append_draw, read_cache, timestamp, writer_lock)

POLL_SECONDS = 900
MAX_CATCHUP = 4


class Automation:
    def __init__(self, cache_path, store_path, *, source=None, clock=None, infer=None,
                 on_cache_change=None, enabled=True):
        self.cache_path = Path(cache_path)
        self.store = SnapshotStore(store_path)
        self.lock_path = self.cache_path.parent / 'astra_runtime' / 'cache.lock'
        self.source = source if source is not None else OnlineSource()
        self.clock = clock if clock is not None else lambda: datetime.now(astra.THAILAND_TZ)
        self.infer = infer if infer is not None else astra.build_astra_report
        self.on_cache_change = on_cache_change if on_cache_change is not None else lambda: None
        self.enabled = enabled
        self._stop = threading.Event()
        self._thread = None
        self._runtime_error = None

    def start(self):
        if not self.enabled or self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name='astra-automation', daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=45)
        return not self.running

    def _run(self):
        while not self._stop.is_set():
            delay = POLL_SECONDS
            try:
                self.tick()
                next_check = self.store.read()['state'].get('next_check_at')
                if next_check:
                    delay = max(1, min(POLL_SECONDS, (timestamp(next_check) - self.clock()).total_seconds()))
            except Exception:
                self._runtime_error = 'internal_error'
            self._stop.wait(delay)

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def status(self, target=None):
        result = {**STATE_DEFAULTS, 'enabled': self.enabled, 'running': self.running,
                  'poll_interval_seconds': POLL_SECONDS, 'snapshot_count': 0, 'snapshot': None}
        try:
            saved = self.store.read(target)
            result.update(saved['state'], snapshot_count=saved['snapshot_count'], snapshot=saved['snapshot'])
        except StorageError as error:
            result.update(phase='error', error=error.code)
        if self._runtime_error:
            result.update(phase='error', error=self._runtime_error)
        if not self.enabled:
            result['phase'] = 'disabled'
        elif self._stop.is_set():
            result['phase'] = 'stopped'
        return result

    def _record(self, state):
        self.store.write_state(state)
        if self.store.read()['state'] != state:
            raise StorageError('storage_invalid')

    def tick(self):
        if not self.enabled or self._stop.is_set():
            return False
        try:
            with writer_lock(self.lock_path) as acquired:
                if not acquired:
                    return False
                state = {**STATE_DEFAULTS, **self.store.read()['state']}
                now = astra._generation_time(self.clock())
                if state['next_check_at'] and now < timestamp(state['next_check_at']):
                    return False
                state.update(phase='checking', error=None, last_check_at=now.isoformat(),
                             next_check_at=(now + timedelta(seconds=POLL_SECONDS)).isoformat(), target_date=None)
                self._record(state)  # Persist rate limit before touching the source, even on crash.
                self._runtime_error = None
                try:
                    self._cycle(state, now)
                except (StorageError, SourceError) as error:
                    code = error.code if error.code in ERRORS else 'internal_error'
                    phase = ('waiting_results' if code == 'results_pending' else
                             'waiting_calendar' if code == 'calendar_unavailable' else 'error')
                    state.update(phase=phase, error=code)
                except Exception:
                    state.update(phase='error', error='internal_error')
                self._record(state)
                return True
        except StorageError as error:
            self._runtime_error = error.code if error.code in ERRORS else 'storage_unavailable'
            return False

    def _cycle(self, state, now):
        view = read_cache(self.cache_path, now.date())
        state['latest_source_date'] = view.latest.isoformat()
        calendar = self.source.calendar()
        if view.latest not in calendar:
            raise SourceError('calendar_invalid')  # Never jump across an unlisted historical gap.
        pending = [day for day in calendar if view.latest < day <= now.date()]
        for day in pending[:MAX_CATCHUP]:
            if self._stop.is_set():
                return
            row = self.source.draw(day)
            validate_draw(row, day)
            if self._stop.is_set():
                return
            append_draw(self.cache_path, view, row, now.date())
            view = read_cache(self.cache_path, now.date())
            state['latest_source_date'] = view.latest.isoformat()
            self.on_cache_change()
        if len(pending) > MAX_CATCHUP:
            state['phase'] = 'catching_up'
            return
        candidates = [day for day in calendar if day > view.latest]
        if not candidates:
            raise SourceError('calendar_unavailable')
        target = min(candidates).isoformat()
        generated = astra._generation_time(self.clock())
        try:
            astra.validate_astra_target_date(target, generated_at=generated)
        except astra.AstraInputError:
            raise SourceError('calendar_unavailable') from None
        state['target_date'] = target
        existing = self.store.read(target)['snapshot']
        if existing and existing['source_draw_date'] == view.latest.isoformat():
            state.update(phase='waiting', last_success_at=existing['captured_at'])
            return
        if self._stop.is_set():
            return
        engine_path = Path(astra.__file__)
        engine_hash = sha256(engine_path.read_bytes()).hexdigest()
        try:
            report = self.infer(view.rows, target, generated_at=generated)
        except Exception:
            raise SourceError('inference_failed') from None
        if self._stop.is_set():
            return
        if self.cache_path.read_bytes() != view.raw or sha256(engine_path.read_bytes()).hexdigest() != engine_hash:
            raise StorageError('cache_changed')
        if astra._generation_time(self.clock()).date() >= datetime.fromisoformat(target).date():
            raise SourceError('calendar_unavailable')
        report['source'] = 'existing_local_cache'
        snapshot = {'formula_version': 'astra-v1', 'source_draw_date': view.latest.isoformat(),
                    'target_date': target, 'captured_at': generated.isoformat(),
                    'cache_sha256': view.digest, 'engine_sha256': engine_hash,
                    'source': 'sanook', 'calendar_source': 'glo', 'report': report}
        saved = self.store.save(snapshot)
        state.update(phase='saved', last_success_at=saved['captured_at'])
