"""Fano-inspired formula family for Thai six-digit first-prize experiments."""
import hashlib
import json
import random
import re
from datetime import datetime
from math import exp


VERSION = 'fano-v4-variable-neighborhood-cover'
NAME = 'ระนาบฟาโน v4 · Variable Neighborhood Cover'
VERSION_V5 = 'fano-v5-adaptive-rank-codebook'
NAME_V5 = 'ระนาบฟาโน v5 · Adaptive Rank Codebook'
MIN_VALID_DRAWS = 20
PAIR_ALPHA = 0.5
MIN_HAMMING_DISTANCE = 3
BEAM_WIDTH = 512  # greedy pair-cover beam used by the ADR-0008 seed
OPTIMIZER_MAX_SWEEPS = 60
VNS_RESTARTS = 5
VNS_PROPOSALS_PER_RESTART = 1200
VNS_START_TEMPERATURE = 0.03
VNS_END_TEMPERATURE = 0.001
POSITION_PAIRS = tuple((left, right) for left in range(6) for right in range(left + 1, 6))
PAIR_INDEX = {pair: index for index, pair in enumerate(POSITION_PAIRS)}

# A standard labeling of the seven lines of PG(2, 2). Each pair of points
# occurs together on exactly one line; the 7x7 incidence code has distance 4.
FANO_LINES = (
    (0, 1, 2),
    (0, 3, 4),
    (0, 5, 6),
    (1, 3, 5),
    (1, 4, 6),
    (2, 3, 6),
    (2, 4, 5),
)

# Fixed configuration selected by the prior-only adaptive search over one
# million Fano codebook variants. The search itself used the same 759 historical
# target outcomes, so v5 is explicitly a retrospective experiment.
V5_SIGNAL_BY_POSITION = (
    'previous-digit-transition',
    'ewm-half-life-24',
    'all-history',
    'rolling-240',
    'rolling-120',
    'rolling-120',
)
# Zero-based positions in each signal's ranked digit list (as in the search).
V5_RANK_PAIRS_BY_POSITION = ((6, 7), (5, 8), (1, 6), (2, 3), (7, 9), (2, 8))
V5_PUNCTURED_LINE = 7
V5_OMITTED_POINTS = (1, 6)


def _position_pair_counts(valid_draws):
    counts = [[0] * 100 for _ in POSITION_PAIRS]
    for _, values in valid_draws:
        if (not isinstance(values, (tuple, list)) or len(values) != 1
                or not isinstance(values[0], str) or len(values[0]) != 6
                or not values[0].isascii() or not values[0].isdigit()):
            raise ValueError('Fano accepts validated six-digit first-prize values only')
        digits = [ord(char) - ord('0') for char in values[0]]
        for pair_index, (left, right) in enumerate(POSITION_PAIRS):
            counts[pair_index][digits[left] * 10 + digits[right]] += 1
    return counts


def _tie_key(seed, round_index, prefix):
    value = int.from_bytes(seed[:8], 'big') ^ (round_index * 0x9E3779B97F4A7C15)
    for digit in prefix:
        value = (value * 6364136223846793005 + digit + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
    return value


def _best_uncovered_candidate(pair_counts, covered, selected, seed, round_index):
    """Use a bounded beam search over all ten digits at each ordered position."""
    beam = [(0.0, (), ())]
    for position in range(6):
        expanded = []
        for score, prefix, mismatch_counts in beam:
            for digit in range(10):
                gain = 0.0
                for left, previous_digit in enumerate(prefix):
                    pair_index = PAIR_INDEX[(left, position)]
                    pattern_index = previous_digit * 10 + digit
                    if pattern_index not in covered[pair_index]:
                        gain += pair_counts[pair_index][pattern_index] + PAIR_ALPHA
                candidate_prefix = prefix + (digit,)
                candidate_mismatches = tuple(
                    mismatch + (digit != candidate[position])
                    for mismatch, candidate in zip(mismatch_counts, selected)
                )
                remaining = 5 - position
                if any(value + remaining < MIN_HAMMING_DISTANCE for value in candidate_mismatches):
                    continue
                expanded.append((score + gain, candidate_prefix, candidate_mismatches))
        if not expanded:
            return None, 0.0
        expanded.sort(key=lambda item: (-item[0], _tie_key(seed, round_index, item[1])))
        beam = expanded[:BEAM_WIDTH]

    for score, digits, mismatches in beam:
        if all(value >= MIN_HAMMING_DISTANCE for value in mismatches):
            return ''.join(str(digit) for digit in digits), score
    return None, 0.0


def _portfolio_coverage_score(rows, pair_counts, denominator):
    coverage_counts = [[0] * 100 for _ in POSITION_PAIRS]
    for row in rows:
        for pair_index, (left, right) in enumerate(POSITION_PAIRS):
            coverage_counts[pair_index][row[left] * 10 + row[right]] += 1
    score = sum(
        (pair_counts[pair_index][pattern] + PAIR_ALPHA) / denominator
        for pair_index, counts in enumerate(coverage_counts)
        for pattern, covered_count in enumerate(counts) if covered_count
    )
    return score, [
        {pattern for pattern, covered_count in enumerate(counts) if covered_count}
        for counts in coverage_counts
    ]


def _portfolio_is_diverse(rows):
    return all(
        sum(left != right for left, right in zip(rows[i], rows[j])) >= MIN_HAMMING_DISTANCE
        for i in range(len(rows)) for j in range(i + 1, len(rows))
    )


def _canonical_portfolio(rows):
    return tuple(sorted(''.join(str(digit) for digit in row) for row in rows))


def _coordinate_move_is_diverse(rows, row_index, position, old_digit, new_digit):
    for other_index, other in enumerate(rows):
        if other_index == row_index:
            continue
        current_distance = sum(a != b for a, b in zip(rows[row_index], other))
        proposed_distance = (current_distance - int(old_digit != other[position])
                             + int(new_digit != other[position]))
        if proposed_distance < MIN_HAMMING_DISTANCE:
            return False
    return True


def _coordinate_move_delta(rows, coverage_counts, pair_counts, denominator,
                           row_index, position, old_digit, new_digit):
    row = rows[row_index]
    delta = 0.0
    for other_position, other_digit in enumerate(row):
        if other_position == position:
            continue
        left, right = sorted((position, other_position))
        pair_index = PAIR_INDEX[(left, right)]
        if position < other_position:
            old_pattern = old_digit * 10 + other_digit
            new_pattern = new_digit * 10 + other_digit
        else:
            old_pattern = other_digit * 10 + old_digit
            new_pattern = other_digit * 10 + new_digit
        if old_pattern == new_pattern:
            continue
        if coverage_counts[pair_index][old_pattern] == 1:
            delta -= (pair_counts[pair_index][old_pattern] + PAIR_ALPHA) / denominator
        if coverage_counts[pair_index][new_pattern] == 0:
            delta += (pair_counts[pair_index][new_pattern] + PAIR_ALPHA) / denominator
    return delta


def _apply_coordinate_move(rows, coverage_counts, row_index, position,
                           old_digit, new_digit):
    row = rows[row_index]
    for other_position, other_digit in enumerate(row):
        if other_position == position:
            continue
        left, right = sorted((position, other_position))
        pair_index = PAIR_INDEX[(left, right)]
        if position < other_position:
            old_pattern = old_digit * 10 + other_digit
            new_pattern = new_digit * 10 + other_digit
        else:
            old_pattern = other_digit * 10 + old_digit
            new_pattern = other_digit * 10 + new_digit
        if old_pattern != new_pattern:
            coverage_counts[pair_index][old_pattern] -= 1
            coverage_counts[pair_index][new_pattern] += 1
    row[position] = new_digit


def _optimize_portfolio(initial, pair_counts, denominator, seed, start_index,
                       *, cache_coordinate_distances=True):
    import random

    rows = [[int(char) for char in number] for number in initial]
    rng_seed = int.from_bytes(
        hashlib.sha256(seed + b':optimizer:' + str(start_index).encode()).digest()[:8], 'big'
    )
    rng = random.Random(rng_seed)
    score, _ = _portfolio_coverage_score(rows, pair_counts, denominator)
    coverage_counts = [[0] * 100 for _ in POSITION_PAIRS]
    for row in rows:
        for pair_index, (left, right) in enumerate(POSITION_PAIRS):
            coverage_counts[pair_index][row[left] * 10 + row[right]] += 1
    completed_sweeps = 0

    for sweep in range(OPTIMIZER_MAX_SWEEPS):
        coordinates = [(row_index, position) for row_index in range(5) for position in range(6)]
        rng.shuffle(coordinates)
        changed = False
        for row_index, position in coordinates:
            original = rows[row_index][position]
            forbidden_digits = set()
            blocked_all_digits = False
            if cache_coordinate_distances:
                for other_index, other in enumerate(rows):
                    if other_index == row_index:
                        continue
                    current_distance = sum(a != b for a, b in zip(rows[row_index], other))
                    other_digit = other[position]
                    distance_if_equal = current_distance - int(original != other_digit)
                    if distance_if_equal < MIN_HAMMING_DISTANCE:
                        forbidden_digits.add(other_digit)
                        if distance_if_equal + 1 < MIN_HAMMING_DISTANCE:
                            blocked_all_digits = True
            best_digit = original
            best_score = score
            digit_order = list(range(10))
            rng.shuffle(digit_order)
            for digit in digit_order:
                if digit == original:
                    continue
                if cache_coordinate_distances:
                    if blocked_all_digits or digit in forbidden_digits:
                        continue
                elif not _coordinate_move_is_diverse(rows, row_index, position, original, digit):
                    continue
                delta = _coordinate_move_delta(
                    rows, coverage_counts, pair_counts, denominator,
                    row_index, position, original, digit
                )
                candidate_score = score + delta
                if candidate_score > best_score + 1e-12:
                    best_digit = digit
                    best_score = candidate_score
            if best_digit != original:
                _apply_coordinate_move(
                    rows, coverage_counts, row_index, position, original, best_digit
                )
                score = best_score
                changed = True
        completed_sweeps = sweep + 1
        if not changed:
            break

    canonical = _canonical_portfolio(rows)
    score, covered = _portfolio_coverage_score(rows, pair_counts, denominator)
    return canonical, score, covered, completed_sweeps


def _row_move_delta(rows, coverage_counts, pair_counts, denominator, row_index, candidate):
    """Return the exact coverage-score change from replacing one whole row."""
    current = rows[row_index]
    delta = 0.0
    for pair_index, (left, right) in enumerate(POSITION_PAIRS):
        old_pattern = current[left] * 10 + current[right]
        new_pattern = candidate[left] * 10 + candidate[right]
        if old_pattern == new_pattern:
            continue
        if coverage_counts[pair_index][old_pattern] == 1:
            delta -= (pair_counts[pair_index][old_pattern] + PAIR_ALPHA) / denominator
        if coverage_counts[pair_index][new_pattern] == 0:
            delta += (pair_counts[pair_index][new_pattern] + PAIR_ALPHA) / denominator
    return delta


def _apply_row_move(rows, coverage_counts, row_index, candidate):
    current = rows[row_index]
    for pair_index, (left, right) in enumerate(POSITION_PAIRS):
        old_pattern = current[left] * 10 + current[right]
        new_pattern = candidate[left] * 10 + candidate[right]
        if old_pattern != new_pattern:
            coverage_counts[pair_index][old_pattern] -= 1
            coverage_counts[pair_index][new_pattern] += 1
    rows[row_index] = candidate


def _perturbed_portfolio(initial, rng):
    """Make a seeded block-move restart while preserving portfolio diversity."""
    for _ in range(100):
        rows = [list(row) for row in initial]
        change_count = rng.randint(4, 9)
        for _ in range(change_count):
            row_index = rng.randrange(5)
            position = rng.randrange(6)
            rows[row_index][position] = rng.randrange(10)
        if _portfolio_is_diverse(rows) and rows != initial:
            return rows
    return [list(row) for row in initial]


def _anneal_portfolio(initial, pair_counts, denominator, seed, restart_index):
    """Explore digit, block, and whole-row neighborhoods with deterministic SA."""
    import random

    rng_seed = int.from_bytes(
        hashlib.sha256(seed + b':vns:' + str(restart_index).encode()).digest()[:8], 'big'
    )
    rng = random.Random(rng_seed)
    initial_rows = [[int(char) for char in number] for number in initial]
    rows = (_perturbed_portfolio(initial_rows, rng) if restart_index else
            [list(row) for row in initial_rows])
    score, _ = _portfolio_coverage_score(rows, pair_counts, denominator)
    coverage_counts = [[0] * 100 for _ in POSITION_PAIRS]
    for row in rows:
        for pair_index, (left, right) in enumerate(POSITION_PAIRS):
            coverage_counts[pair_index][row[left] * 10 + row[right]] += 1
    best_rows = [list(row) for row in rows]
    best_score = score
    accepted = 0
    valid = 0

    for step in range(VNS_PROPOSALS_PER_RESTART):
        progress = step / max(1, VNS_PROPOSALS_PER_RESTART - 1)
        temperature = VNS_START_TEMPERATURE * (
            VNS_END_TEMPERATURE / VNS_START_TEMPERATURE
        ) ** progress
        neighborhood_draw = rng.random()
        if neighborhood_draw < 0.05:
            radius = 6  # whole-row replacement
        elif progress < 0.5:
            radius = rng.choices((1, 2, 3), weights=(0.52, 0.32, 0.16), k=1)[0]
        else:
            radius = rng.choices((1, 2, 3), weights=(0.72, 0.21, 0.07), k=1)[0]

        row_index = rng.randrange(5)
        current = rows[row_index]
        if radius == 6:
            candidate = [rng.randrange(10) for _ in range(6)]
        else:
            candidate = list(current)
            for position in rng.sample(range(6), radius):
                digit = rng.randrange(9)
                candidate[position] = digit if digit < current[position] else digit + 1

        if any(
            other_index != row_index
            and sum(a != b for a, b in zip(candidate, other)) < MIN_HAMMING_DISTANCE
            for other_index, other in enumerate(rows)
        ):
            continue

        valid += 1
        delta = _row_move_delta(
            rows, coverage_counts, pair_counts, denominator, row_index, candidate
        )
        if delta >= -1e-12 or rng.random() < exp(delta / temperature):
            _apply_row_move(rows, coverage_counts, row_index, candidate)
            score += delta
            accepted += 1
            if (score > best_score + 1e-12
                    or (score >= best_score and abs(score - best_score) <= 1e-12
                        and _canonical_portfolio(rows) < _canonical_portfolio(best_rows))):
                best_rows = [list(row) for row in rows]
                best_score = score

    canonical = _canonical_portfolio(best_rows)
    actual_score, covered = _portfolio_coverage_score(
        [[int(char) for char in number] for number in canonical], pair_counts, denominator
    )
    return canonical, actual_score, covered, accepted, valid


def _greedy_pair_cover(pair_counts, seed):
    """Pick five candidates by greedy marginal coverage of the uncovered pair mass."""
    covered = [set() for _ in POSITION_PAIRS]
    selected = []
    for round_index in range(5):
        candidate, _ = _best_uncovered_candidate(
            pair_counts, covered, selected, seed, round_index
        )
        if candidate is None:
            raise RuntimeError(
                'Fano greedy pair-cover could not construct five diverse candidates'
            )
        digits = [int(char) for char in candidate]
        for pair_index, (left, right) in enumerate(POSITION_PAIRS):
            covered[pair_index].add(digits[left] * 10 + digits[right])
        selected.append(tuple(digits))
    return [''.join(str(digit) for digit in row) for row in selected]


def _seed_portfolio(valid_draws, seed):
    """Build v4's incumbent from the history fingerprint alone (ADR-0008).

    The retired v3 incumbent was, in practice, the greedy pair-cover portfolio
    polished by coordinate ascent, so v4 rebuilds exactly that instead of
    calling build_v3 -> build_v2 -> build_v1. Same materials (the prior draws
    and their ordered pair counts), deterministic tie-breaks from the target's
    seed, and no history beyond the target cutoff.
    """
    pair_counts = _position_pair_counts(valid_draws)
    denominator = len(valid_draws) + 100 * PAIR_ALPHA
    numbers = _greedy_pair_cover(pair_counts, seed)
    raw_score, _ = _portfolio_coverage_score(
        [[int(char) for char in number] for number in numbers], pair_counts, denominator
    )
    portfolio, score, covered, sweeps = _optimize_portfolio(
        numbers, pair_counts, denominator, seed, 0
    )
    return list(portfolio), raw_score, score, covered, sweeps


def build(valid_draws, target_date, history_sha256):
    """Build v4 from a self-seeded incumbent (ADR-0008) plus variable neighborhoods."""
    if len(valid_draws) < MIN_VALID_DRAWS:
        raise ValueError('Fano requires at least 20 valid prior first-prize draws')

    pair_counts = _position_pair_counts(valid_draws)
    total = len(valid_draws)
    denominator = total + 100 * PAIR_ALPHA
    seed_material = json.dumps(
        [VERSION, target_date, history_sha256], ensure_ascii=True, separators=(',', ':')
    )
    seed = hashlib.sha256(seed_material.encode('utf-8')).digest()
    (incumbent_numbers, incumbent_seed_score, incumbent_score,
     incumbent_covered, seed_sweeps) = _seed_portfolio(valid_draws, seed)
    incumbent_rows = [[int(char) for char in number] for number in incumbent_numbers]
    best = dict(portfolio=_canonical_portfolio(incumbent_rows), score=incumbent_score,
                covered=incumbent_covered, start='self-seeded', polish_sweeps=0)
    accepted_moves = 0
    valid_proposals = 0
    restart_scores = []

    for restart_index in range(VNS_RESTARTS):
        portfolio, score, covered, accepted, valid = _anneal_portfolio(
            incumbent_numbers, pair_counts, denominator, seed, restart_index
        )
        accepted_moves += accepted
        valid_proposals += valid
        polished, polished_score, polished_covered, sweeps = _optimize_portfolio(
            portfolio, pair_counts, denominator, seed, 100 + restart_index
        )
        restart_scores.append(round(polished_score, 8))
        if (polished_score > best['score'] + 1e-12
                or (polished_score >= best['score']
                    and abs(polished_score - best['score']) <= 1e-12
                    and polished < best['portfolio'])):
            best = dict(portfolio=polished, score=polished_score,
                        covered=polished_covered, start=f'vns-{restart_index + 1}',
                        polish_sweeps=sweeps)

    pair_summary = []
    for pair_index, (left, right) in enumerate(POSITION_PAIRS):
        top_patterns = sorted(
            range(100), key=lambda pattern: (-pair_counts[pair_index][pattern], pattern)
        )[:3]
        pair_summary.append({
            'positions': [left + 1, right + 1],
            'covered_patterns': len(best['covered'][pair_index]),
            'top_historical_patterns': [
                {
                    'digits': f'{pattern // 10}{pattern % 10}',
                    'draws': pair_counts[pair_index][pattern],
                    'smoothed_weight': round((pair_counts[pair_index][pattern] + PAIR_ALPHA) / denominator, 8),
                }
                for pattern in top_patterns
            ],
        })

    numbers = list(best['portfolio'])
    settings = {
        'name': NAME,
        'hypothesis': 'historical two-position digit-pair weights may help assemble a jointly optimized diverse portfolio; unproven',
        'target': 'exact six-digit prize1 only',
        'lookback_policy': 'all accessible valid prize1 draws before the target date',
        'training_policy': 'all accessible prior cache draws',
        'max_draws': None,
        'minimum_valid_draws': MIN_VALID_DRAWS,
        'valid_draws': total,
        'construction': 'joint five-row, six-position weighted pair-cover with block and whole-row neighborhood search',
        'candidate_count': 5,
        'selection_method': 'deterministic simulated annealing over 1-6 digit neighborhoods followed by coordinate-ascent polish',
        'optimizer_starts': VNS_RESTARTS,
        'optimizer_restarts': VNS_RESTARTS,
        'optimizer_proposals_per_restart': VNS_PROPOSALS_PER_RESTART,
        'optimizer_valid_proposals': valid_proposals,
        'optimizer_accepted_moves': accepted_moves,
        'optimizer_start_temperature': VNS_START_TEMPERATURE,
        'optimizer_end_temperature': VNS_END_TEMPERATURE,
        'optimizer_polish_max_sweeps': OPTIMIZER_MAX_SWEEPS,
        'optimizer_polish_sweeps_best_start': best['polish_sweeps'],
        'optimizer_base_version': 'self-seeded',
        'optimizer_seed_policy': 'greedy weighted pair-cover over all digits with fingerprint tie-breaks, polished by coordinate ascent',
        'optimizer_seed_score': round(incumbent_seed_score, 8),
        'optimizer_seed_polish_sweeps': seed_sweeps,
        'optimizer_base_score': round(incumbent_score, 8),
        'optimizer_restart_scores': restart_scores,
        'optimized_start': best['start'],
        'pair_smoothing_alpha': PAIR_ALPHA,
        'position_pair_coverage': pair_summary,
        'weighted_pair_coverage_score': round(best['score'], 8),
        'minimum_pairwise_hamming_distance': min(
            sum(a != b for a, b in zip(left, right))
            for index, left in enumerate(best['portfolio'])
            for right in best['portfolio'][index + 1:]
        ),
        'selection_seed_sha256': hashlib.sha256(seed_material.encode('utf-8')).hexdigest(),
        'odds_disclosure': 'the formula ranks a jointly optimized portfolio using historical pair weights; it does not change the number of distinct six-digit candidates selected',
        'source_scope': 'adapts the source paper pair-cover idea to ordered Thai digit positions; it is not the UK Lotto 27-ticket construction',
    }
    return numbers, settings


def _rank_digits(scores, tie_scores=None):
    if tie_scores is None:
        return sorted(range(10), key=lambda digit: (-float(scores[digit]), digit))
    return sorted(
        range(10),
        key=lambda digit: (-float(scores[digit]), -float(tie_scores[digit]), digit),
    )


def _v5_signal_rankings(chronological_draws):
    """Rank digits for the fixed v5 signals using only the supplied prior draws."""
    total = len(chronological_draws)
    global_counts = [[0.0] * 10 for _ in range(6)]
    for draw in chronological_draws:
        for position, digit in enumerate(draw):
            global_counts[position][digit] += 1.0

    signal_rankings = {}
    for signal in set(V5_SIGNAL_BY_POSITION):
        by_position = []
        for position in range(6):
            scores = list(global_counts[position])
            tie_scores = None
            if signal.startswith('rolling-'):
                window = int(signal.split('-', 1)[1])
                scores = [0.0] * 10
                for draw in chronological_draws[-window:]:
                    scores[draw[position]] += 1.0
            elif signal.startswith('ewm-half-life-'):
                half_life = float(signal.rsplit('-', 1)[1])
                scores = [0.0] * 10
                for index, draw in enumerate(chronological_draws):
                    age = total - 1 - index
                    scores[draw[position]] += 2.0 ** (-age / half_life)
            elif signal == 'previous-digit-transition' and total >= 2:
                transition_counts = [0.0] * 10
                context_digit = chronological_draws[-1][position]
                for index in range(1, total):
                    if chronological_draws[index - 1][position] == context_digit:
                        transition_counts[chronological_draws[index][position]] += 1.0
                prior_prob = [
                    (global_counts[position][digit] + 1.0) / (total + 10.0)
                    for digit in range(10)
                ]
                scores = [transition_counts[digit] + 5.0 * prior_prob[digit]
                          for digit in range(10)]
                tie_scores = global_counts[position]
            by_position.append(_rank_digits(scores, tie_scores))
        signal_rankings[signal] = by_position
    return signal_rankings


def build_v5(valid_draws, target_date, history_sha256):
    """Build v5's fixed adaptive rank codebook from strictly prior valid draws.

    Its signal and rank-pair choices were selected post hoc on the same
    759-draw discovery series. They stay fixed here for prospective tracking;
    the historical search score is not independent validation.
    """
    if len(valid_draws) < MIN_VALID_DRAWS:
        raise ValueError('Fano requires at least 20 valid prior first-prize draws')

    chronological = []
    for age, values in sorted(valid_draws, key=lambda item: item[0], reverse=True):
        if (not isinstance(values, (tuple, list)) or len(values) != 1
                or not isinstance(values[0], str) or len(values[0]) != 6
                or not values[0].isascii() or not values[0].isdigit()):
            raise ValueError('Fano accepts validated six-digit first-prize values only')
        chronological.append([ord(char) - ord('0') for char in values[0]])

    rankings = _v5_signal_rankings(chronological)
    retained_lines = [line for line in range(7) if line != V5_PUNCTURED_LINE - 1]
    retained_points = [point for point in range(7) if point + 1 not in V5_OMITTED_POINTS]
    numbers = []
    for point in retained_points:
        digits = []
        for position, line in enumerate(retained_lines):
            bit = int(point in FANO_LINES[line])
            rank_index = V5_RANK_PAIRS_BY_POSITION[position][bit]
            signal = V5_SIGNAL_BY_POSITION[position]
            digits.append(str(rankings[signal][position][rank_index]))
        numbers.append(''.join(digits))
    if len(set(numbers)) != 5:
        raise RuntimeError('Fano v5 codebook unexpectedly produced duplicate candidates')

    position_choices = []
    for position, (signal, rank_pair) in enumerate(zip(
        V5_SIGNAL_BY_POSITION, V5_RANK_PAIRS_BY_POSITION
    )):
        ranked_digits = rankings[signal][position]
        position_choices.append({
            'position': position + 1,
            'signal': signal,
            'rank_pair': [rank + 1 for rank in rank_pair],
            'digits': [str(ranked_digits[rank]) for rank in rank_pair],
        })

    settings = {
        'name': NAME_V5,
        'hypothesis': 'different prior-only digit-ranking signals by position may create a useful Fano-inspired five-number codebook; unproven',
        'target': 'exact six-digit prize1 only',
        'lookback_policy': 'all accessible valid prize1 draws before the target date',
        'training_policy': 'all accessible prior cache draws',
        'max_draws': None,
        'minimum_valid_draws': MIN_VALID_DRAWS,
        'valid_draws': len(chronological),
        'construction': 'fixed per-position signal ranks encoded by a punctured Fano-plane incidence codebook; omit points 1 and 6 and retain five candidates',
        'candidate_count': 5,
        'signal_by_position': list(V5_SIGNAL_BY_POSITION),
        'rank_pairs_by_position': [list(pair) for pair in V5_RANK_PAIRS_BY_POSITION],
        'position_choices': position_choices,
        'punctured_line': V5_PUNCTURED_LINE,
        'omitted_points': list(V5_OMITTED_POINTS),
        'retained_points': [point + 1 for point in retained_points],
        'codeword_distance': 'at least 3 across retained Fano points after one line coordinate is removed',
        'selected_round': 49739,
        'retrospective_selection': {
            'selected_from_variants': 1_000_000,
            'discovery_target_draws': 759,
            'discovery_hits': 2,
            'discovery_hit_rate_percent': round(2 / 759 * 100, 8),
            'selection_scope': 'configuration selected after scoring these same 759 historical outcomes; post-hoc exploratory result, not an unbiased backtest estimate',
        },
        'configuration_id': hashlib.sha256(json.dumps(
            [VERSION_V5, V5_SIGNAL_BY_POSITION, V5_RANK_PAIRS_BY_POSITION,
             V5_PUNCTURED_LINE, V5_OMITTED_POINTS],
            ensure_ascii=True, separators=(',', ':')
        ).encode('utf-8')).hexdigest(),
        'odds_disclosure': 'five distinct candidates have the same 5/1,000,000 chance as any five distinct candidates under a uniform six-digit draw',
        'source_scope': 'Fano-inspired incidence-code construction adapted to ranked Thai six-digit positions; not the UK Lotto 27-ticket construction',
    }
    return numbers, settings


def _builder_for_version(version):
    builders = {
        VERSION: build,
        VERSION_V5: build_v5,
    }
    try:
        return builders[version]
    except KeyError:
        raise ValueError('unsupported Fano formula version') from None


def _build_version(version, valid_draws, target_date, history_sha256):
    builder = _builder_for_version(version)
    return builder(valid_draws, target_date, history_sha256)


def formula_forecast(target_date, version=VERSION):
    """Build a read-only formula-tab forecast from all valid prior cache draws."""
    import astra
    from datetime import date

    if not isinstance(target_date, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', target_date):
        raise ValueError('target date must use YYYY-MM-DD')
    try:
        target = date.fromisoformat(target_date)
    except ValueError:
        raise ValueError('target date is invalid') from None

    history = astra.load_existing_astra_history()
    generated = datetime.now(astra.THAILAND_TZ)
    return _formula_forecast_from_history(
        history, target_date, target, generated.date(), version=version
    )


def _formula_forecast_from_history(
    history, target_date, target, generation_day, *, allow_insufficient=False,
    version=VERSION,
):
    """Apply a selected Fano rule to a strictly pre-target history window."""
    import astra

    window = astra._history_window(history, target, generation_day, max_draws=None)
    valid_with_dates = []
    for age, (draw_date, row) in enumerate(window):
        values = astra._category_values(row, 'prize1', 6)
        if values is not None:
            valid_with_dates.append((age, values, draw_date))
    valid = [(age, values) for age, values, _ in valid_with_dates]
    history_sha256 = hashlib.sha256(
        json.dumps(window, default=str, sort_keys=True).encode()
    ).hexdigest()
    if len(valid) < MIN_VALID_DRAWS and allow_insufficient:
        return {
            'settings': {'valid_draws': len(valid)},
            'provenance': {'history_sha256': history_sha256},
        }
    numbers, settings = _build_version(version, valid, target.isoformat(), history_sha256)
    settings['training_start_date'] = (
        valid_with_dates[-1][2].isoformat() if valid_with_dates else None
    )
    settings['training_cutoff_date'] = (
        valid_with_dates[0][2].isoformat() if valid_with_dates else None
    )
    return {
        'ok': True,
        'formula': version,
        'target_date': target.isoformat(),
        'numbers': numbers,
        'settings': settings,
        'history_rows': len(window),
        'provenance': {
            'history_sha256': history_sha256,
            'history_rows': len(window),
            'valid_draws': len(valid),
        },
    }


def formula_backtest_forecasts(target_dates, version=VERSION):
    """Create walk-forward candidates for historical target dates."""
    import astra
    from datetime import date

    if not isinstance(target_dates, list) or not 1 <= len(target_dates) <= 600:
        raise ValueError('Fano backtest requires between 1 and 600 target dates')
    _builder_for_version(version)
    parsed_targets = []
    seen = set()
    for value in target_dates:
        if (not isinstance(value, str)
                or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value)):
            raise ValueError('target dates must use YYYY-MM-DD')
        try:
            target = date.fromisoformat(value)
        except ValueError:
            raise ValueError('target date is invalid') from None
        if target.isoformat() != value or value in seen:
            raise ValueError('target dates must be canonical and unique')
        seen.add(value)
        parsed_targets.append((value, target))

    history = astra.load_existing_astra_history()
    generation_day = datetime.now(astra.THAILAND_TZ).date()
    forecasts = []
    skipped_targets = []
    for target_date, target in parsed_targets:
        forecast = _formula_forecast_from_history(
            history, target_date, target, generation_day, allow_insufficient=True,
            version=version,
        )
        if forecast['settings']['valid_draws'] < MIN_VALID_DRAWS:
            skipped_targets.append(target_date)
            continue
        forecasts.append({
            'target_date': target_date,
            'numbers': forecast['numbers'],
            'valid_draws': forecast['settings']['valid_draws'],
            'history_sha256': forecast['provenance']['history_sha256'],
        })
    return {
        'ok': True,
        'formula': version,
        'forecasts': forecasts,
        'skipped_targets': skipped_targets,
    }
