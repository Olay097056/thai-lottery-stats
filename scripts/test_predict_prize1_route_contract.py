"""Exercise the real prize-one route body without FastAPI or live cache access."""
import ast
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'main.py').read_text(encoding='utf-8')
TREE = ast.parse(SOURCE, filename='main.py')


def route_declaration():
    route = next(node for node in TREE.body
                 if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                 and node.name == 'api_predict_prize1')
    for decorator in route.decorator_list:
        if (isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and isinstance(decorator.func.value, ast.Name)
                and decorator.func.value.id == 'app'
                and decorator.func.attr == 'get'
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and decorator.args[0].value == '/api/predict/prize1'):
            return route
    raise AssertionError('api_predict_prize1 must remain registered as GET /api/predict/prize1')


def target_date_helper():
    return next(node for node in TREE.body
                if isinstance(node, ast.FunctionDef) and node.name == '_target_date')


class FakeHTTPException(Exception):
    def __init__(self, *, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def fake_prediction(_df, target, **_kwargs):
    assert target == datetime(2026, 11, 1)
    return 'fixture forecast'


namespace = {
    'datetime': datetime,
    'HTTPException': FakeHTTPException,
    'Query': lambda default, **_kwargs: default,
    'get_df': lambda: {'fixture': 'read-only dataframe sentinel'},
    '_p1_preset_kwargs': lambda preset: (preset, {'fixture_option': True}),
    'predict_prize1_ultimate': fake_prediction,
    '_safe_records': lambda _result: [{'num': '000007', 'score': 1.0}],
    'P1_PRESETS': {'balanced': {'label': 'Balanced fixture'}},
    '_api_failure': lambda exc, **fallback: {**fallback, 'ok': False},
}

target_helper = target_date_helper()
target_helper.decorator_list = []
route = route_declaration()
route.decorator_list = []
module = ast.fix_missing_locations(ast.Module(body=[target_helper, route], type_ignores=[]))
exec(compile(module, 'main.py#api_predict_prize1', 'exec'), namespace)

payload = namespace['api_predict_prize1'](
    top_n=5, beam_width=50, k_back=10, preset='balanced', date='2026-11-01'
)
assert payload['date'] == '2026-11-01', payload
assert payload['predictions'] == [{'num': '000007', 'score': 1.0}], payload

try:
    namespace['api_predict_prize1'](
        top_n=5, beam_width=50, k_back=10, preset='balanced', date='2026-02-30'
    )
except FakeHTTPException as exc:
    assert exc.status_code == 400
else:
    raise AssertionError('invalid target date must be rejected')

print('PASS: GET /api/predict/prize1 returns its normalized target with leading-zero candidates')
