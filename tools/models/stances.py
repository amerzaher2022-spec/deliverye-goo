"""Poses for the original figures (Skeleton from sculpt.py; game frame: metres, y up, +z forward, +x = left)."""
import numpy as np

from anatomy import FINGERS, SIDES


def curl(sk, side, sx, angles=(20, 25, 15), thumb=(10, 10, 5), spread=0.0):
    """Bend the fingers towards the palm (left palm = local +x, right palm = local -x)."""
    for fi in FINGERS:
        for j, a in enumerate(angles):
            sk.rotate(f'{fi}{j + 1}.{side}', 'z', -sx * a)
        if spread:
            k = {'index': 1, 'middle': 0.3, 'ring': -0.3, 'pinky': -1}[fi]
            sk.rotate(f'{fi}1.{side}', 'x', k * spread)
    for j, a in enumerate(thumb):
        sk.rotate(f'thumb{j + 1}.{side}', 'x', a)


def idle(sk, b, spread=0.05, bend=10, variant=0, abduct=2):
    """Relaxed standing: arms hang a little away from the body, elbows softly bent."""
    for side, sx in SIDES:
        sk.rotate(f'uarm.{side}', 'z', sx * abduct)
        sk.rotate(f'farm.{side}', 'x', -bend)
        curl(sk, side, sx, (18, 22, 12), (6, 8, 4))
    if variant:
        sk.rotate('neck', 'y', 7 * variant)
        sk.rotate('head', 'x', 3)
        sk.rotate('pelvis', 'y', -3 * variant)
        sk.rotate('chest', 'y', 3 * variant)


def carry(sk, b, height=-0.25, depth=0.3, width=0.12):
    """Forearms forward, palms up under a carried load."""
    s = b.s
    for side, sx in SIDES:
        sh = sk.head(f'uarm.{side}')
        target = np.array([sx * width * s, sh[1] + height * s, sh[2] + depth * s])
        sk.ik(f'uarm.{side}', f'farm.{side}', f'hand.{side}', target, (sx * 0.5, -0.6, -1))
        palm = (1, 0, 0) if sx > 0 else (-1, 0, 0)
        sk.aim(f'hand.{side}', (-sx * 0.25, 0.05, 1), roll_axis=palm, roll_target=(0, 1, 0))
        curl(sk, side, sx, (10, 12, 6), (-10, 0, 0))
    sk.rotate('head', 'x', 4)


def seated(sk, b, seat, grip, ankles, lean=14, wrist_back=(0.025, 0.03, 0.07), pole_knee=(0, 0.35, 1), grip_curl=(55, 70, 45)):
    """Riding: pelvis on the seat, hands on the grips, feet on the floorboard or pedals."""
    s = b.s
    sk.move(np.asarray(seat, float) - sk.head('pelvis'))
    sk.rotate('pelvis', 'x', -6)
    sk.rotate('spine', 'x', lean * 0.55 + 3)
    sk.rotate('chest', 'x', lean * 0.45 + 3)
    for (side, sx), ankle in zip(SIDES, ankles):
        sk.ik(f'thigh.{side}', f'shin.{side}', f'foot.{side}', ankle, (sx * 0.15, pole_knee[1], pole_knee[2]))
        sk.aim(f'foot.{side}', (sx * 0.06, -0.12, 1), roll_axis=(0, 0, 1), roll_target=(0, 1, 0))
    gx, gy, gz = grip
    for side, sx in SIDES:
        sk.rotate(f'clav.{side}', 'y', -sx * 16, space='world')   # shoulders reach forward
    for side, sx in SIDES:
        grab(sk, b, side, sx, np.array([sx * gx, gy, gz]), hand_dir=(sx * 0.15, -0.3, 1), palm_to=(0, -1, -0.35),
             curl_angles=grip_curl, wrist_guess=wrist_back)
    sk.rotate('neck', 'x', -lean * 0.5)
    sk.rotate('head', 'x', -lean * 0.4)


def grab(sk, b, side, sx, bar, hand_dir, palm_to, curl_angles=(55, 70, 45), wrist_guess=(0.0, 0.05, 0.05), depth=0.026):
    """Place a hand so the bar runs through the curled fingers (iterative IK), then close the fingers."""
    s = b.s
    palm = np.array([1.0, 0, 0]) if sx > 0 else np.array([-1.0, 0, 0])
    grip_local = palm * depth * s + np.array([0, 0.062 * s, 0])
    target = bar + np.array([0.0, wrist_guess[1], -wrist_guess[2]])
    up, lo, h = f'uarm.{side}', f'farm.{side}', f'hand.{side}'
    for _ in range(5):
        sk.ik(up, lo, h, target, (sx * 1.0, -0.8, -0.5))
        sk.aim(h, hand_dir, roll_axis=palm, roll_target=palm_to)
        target = target + (bar - sk.point(h, grip_local))
    curl(sk, side, sx, curl_angles, (0, 0, 0))
    # thumb wraps under the bar from the inside
    sk.aim(f'thumb1.{side}', (-sx * 0.55, -0.55, 0.62))
    sk.aim(f'thumb2.{side}', (-sx * 0.75, -0.55, 0.2))
    sk.aim(f'thumb3.{side}', (-sx * 0.8, -0.45, -0.15))
