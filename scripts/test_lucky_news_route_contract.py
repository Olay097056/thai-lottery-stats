"""Exercise the real lucky-news route body without FastAPI or live HTTP."""
import ast
import asyncio
from datetime import datetime
from pathlib import Path
import sys
import types


ROOT = Path(__file__).resolve().parents[1]
TREE = ast.parse((ROOT / 'main.py').read_text(encoding='utf-8'), filename='main.py')


def get_route(name, route_path):
    route = next(node for node in TREE.body
                 if isinstance(node, ast.AsyncFunctionDef) and node.name == name)
    for decorator in route.decorator_list:
        if (isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and isinstance(decorator.func.value, ast.Name)
                and decorator.func.value.id == 'app'
                and decorator.func.attr == 'get'
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and decorator.args[0].value == route_path):
            route.decorator_list = []
            return route
    raise AssertionError(f'{name} must remain registered as GET {route_path}')


target_helper = next(node for node in TREE.body
                     if isinstance(node, ast.FunctionDef) and node.name == '_target_date')
target_helper.decorator_list = []


class FakeHTTPException(Exception):
    def __init__(self, *, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code


class FakeResponse:
    def __init__(self, text='', status_error=None):
        self.text = text
        self.status_error = status_error

    def raise_for_status(self):
        if self.status_error:
            raise self.status_error
        return None


class FakeClient:
    requested_urls = []
    responses = []

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, url, **_kwargs):
        type(self).requested_urls.append(url)
        if not type(self).responses:
            raise AssertionError('route requested more sources than the fixture configured')
        response = type(self).responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


httpx_stub = types.ModuleType('httpx')
httpx_stub.AsyncClient = FakeClient
previous_httpx = sys.modules.get('httpx')
sys.modules['httpx'] = httpx_stub

namespace = {
    'datetime': datetime,
    'HTTPException': FakeHTTPException,
    'Query': lambda default, **_kwargs: default,
}
route = get_route('api_lucky_news', '/api/lucky-news')
module = ast.fix_missing_locations(ast.Module(
    body=[target_helper, route], type_ignores=[]
))
exec(compile(module, 'main.py#api_lucky_news', 'exec'), namespace)

try:
    FakeClient.responses = [FakeResponse('Lucky results include 007 and 05.')]
    FakeClient.requested_urls = []
    payload = asyncio.run(namespace['api_lucky_news']('2026-11-01'))

    success_urls = list(FakeClient.requested_urls)

    FakeClient.responses = [FakeResponse('ไม่มีเลขที่ตรงรูปแบบ')]
    FakeClient.requested_urls = []
    empty_payload = asyncio.run(namespace['api_lucky_news']('2026-11-01'))

    FakeClient.responses = [
        FakeResponse(status_error=RuntimeError('private HTTP source details')),
        FakeResponse('Fallback results include 123 and 45.'),
    ]
    FakeClient.requested_urls = []
    fallback_payload = asyncio.run(namespace['api_lucky_news']('2026-11-01'))
    fallback_urls = list(FakeClient.requested_urls)

    FakeClient.responses = [
        FakeResponse(status_error=RuntimeError('private HTTP source details')),
        FakeResponse(status_error=RuntimeError('private fallback HTTP details')),
    ]
    FakeClient.requested_urls = []
    http_failures = asyncio.run(namespace['api_lucky_news']('2026-11-01'))

    FakeClient.responses = [
        RuntimeError('private connection details'),
        RuntimeError('private fallback connection details'),
    ]
    FakeClient.requested_urls = []
    connection_failures = asyncio.run(namespace['api_lucky_news']('2026-11-01'))
finally:
    if previous_httpx is None:
        del sys.modules['httpx']
    else:
        sys.modules['httpx'] = previous_httpx

assert payload['date'] == '2026-11-01', payload
assert payload['query'] == 'เลขเด็ด 1 พ.ย. 2569', payload
assert payload['numbers_3'][0] == '007', payload
assert payload['numbers_2'][0] == '05', payload
assert len(success_urls) == 1 and 'sanook.com' in success_urls[0], success_urls
assert empty_payload['sources'] and empty_payload['numbers_3'] == [] and empty_payload['numbers_2'] == [], empty_payload
assert 'ok' not in empty_payload and 'error_code' not in empty_payload, empty_payload
assert len(fallback_urls) == 2 and 'sanook.com' in fallback_urls[0] and 'thairath.co.th' in fallback_urls[1], fallback_urls
assert fallback_payload['date'] == '2026-11-01', fallback_payload
assert fallback_payload.get('ok') is not False and 'error_code' not in fallback_payload, fallback_payload
assert len(fallback_payload['sources']) == 1 and 'thairath.co.th' in fallback_payload['sources'][0], fallback_payload
assert fallback_payload['numbers_3'][0] == '123' and fallback_payload['numbers_2'][0] == '45', fallback_payload

for failed_payload in (http_failures, connection_failures):
    assert failed_payload['date'] == '2026-11-01', failed_payload
    assert failed_payload['ok'] is False, failed_payload
    assert failed_payload['error_code'] == 'news_source_unavailable', failed_payload
    assert failed_payload['retryable'] is True, failed_payload
    assert failed_payload['sources'] == [], failed_payload
    assert 'private' not in str(failed_payload), failed_payload

print('PASS: GET /api/lucky-news distinguishes empty success, uses source fallback, and safely reports HTTP/connection failures')
