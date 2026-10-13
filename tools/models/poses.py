"""Poses for the generated people (game frame: metres, x = the figure's left, y up, +z forward)."""
import numpy as np

import mh

SIDES = (('L', 1), ('R', -1))


def g(p, bone, end='head'):
    """Posed joint position in the game frame."""
    return 0.1 * p.posed(bone, end) + p.offset


def stand_on_ground(p):
    p.offset = np.array([0.0, -0.1 * p.v[:, 1].min() - 0.004, 0.0])


def hands(p, side, curl, thumb):
    for k, v in mh.curl(p.v, side, curl, thumb=thumb).items():
        p.add(k, *v)


def idle(p, spread=0.05, bend=0.06, variant=0):
    """Relaxed standing, arms down."""
    stand_on_ground(p)
    for s, sx in SIDES:
        sh = g(p, f'upperarm01.{s}')
        p.ik((f'upperarm01.{s}', f'lowerarm01.{s}', f'wrist.{s}'), sh + np.array([sx * spread, -0.54, bend]), (sx * 0.3, 0, -1))
        p.aim(f'wrist.{s}', f'finger3-1.{s}', (sx * 0.08, -1, 0.1), f'finger5-1.{s}', (0, 0, -1))
        hands(p, s, 18, 10)
    if variant:
        p.add('neck01', ('y', 8 * variant))
        p.add('head', ('x', 4))


def carry(p, depth=0.32, height=-0.28, width=0.17):
    """Standing, forearms forward and palms up under a carried load (trays, pizza boxes)."""
    stand_on_ground(p)
    for s, sx in SIDES:
        sh = g(p, f'upperarm01.{s}')
        target = np.array([sx * width, sh[1] + height, sh[2] + depth])
        p.ik((f'upperarm01.{s}', f'lowerarm01.{s}', f'wrist.{s}'), target, (sx * 0.4, -0.6, -1))
        p.aim(f'wrist.{s}', f'finger3-1.{s}', (-sx * 0.35, 0.05, 1), f'finger5-1.{s}', (0, -1, 0))
        hands(p, s, 12, -10)
    p.add('head', ('x', 6))


def seated(p, seat, grip, wrist_back, ankles, lean=12, pole_knee=(0, 0.35, 1), look=None):
    """Riding: pelvis on the seat, hands on the grips, feet on the floorboard/pedals."""
    root = p.jp('root')
    p.offset = np.asarray(seat, float) - 0.1 * root
    for b in ('spine05', 'spine04', 'spine03', 'spine02', 'spine01'):
        p.add(b, ('x', lean / 5))
    for (s, sx), ankle in zip(SIDES, ankles):
        p.add(f'upperleg01.{s}', ('x', -70))
        p.ik((f'upperleg01.{s}', f'lowerleg01.{s}', f'foot.{s}'), ankle, (sx * 0.15, pole_knee[1], pole_knee[2]))
        p.aim(f'foot.{s}', f'toe3-1.{s}', (sx * 0.05, -0.22, 1))
    for s, sx in SIDES:
        gx, gy, gz = grip
        target = np.array([sx * gx, gy, gz]) + np.array([-sx * wrist_back[0], wrist_back[1], -wrist_back[2]])
        p.ik((f'upperarm01.{s}', f'lowerarm01.{s}', f'wrist.{s}'), target, (sx * 1.0, -0.7, -0.4))
        p.aim(f'wrist.{s}', f'finger3-1.{s}', (sx * 0.12, -0.45, 1), f'finger5-1.{s}', (sx * 1, -0.2, 0))
        hands(p, s, 72, 28)
    p.add('neck01', ('x', -lean * 0.45))
    p.add('head', ('x', -lean * 0.35 + (look or 0)))
