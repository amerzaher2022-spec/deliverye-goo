"""The game's original cast: who they are, what they wear, how they stand.

Each entry returns (build, skeleton, figure, painter). Designed for Erbil Delivery World:
the courier wears the app's charcoal-and-amber uniform; the townspeople reflect Erbil's streets.
"""
import numpy as np

import anatomy as an
import paint as pa
import sculpt as sc
import stances as st
import wardrobe as wd

AMBER = '#e38b1d'
CHAR = '#26282d'


def _base(build, pose=None, brow=1.0, nose=1.0, jaw=1.0, lips=1.0):
    sk = an.skeleton(build)
    if pose:
        pose(sk, build)
    fig = sc.Figure(sk)
    an.body(fig, build)
    an.head(fig, build, brow=brow, nose=nose, jaw=jaw, lips=lips)
    pt = pa.Painter(fig, build)
    return sk, fig, pt


def _face(pt, tone, stubble=0.0, iris='#4a2f1a', lips='#9a5a52', brows='#2a1d16', hair='#17120f', brow_w=1.0):
    pt.set('skin', pa.skin(tone, stubble=stubble, brows=brows, brow_w=brow_w))
    pt.set('nail', pa.lin('#d8ab9b'))
    pt.set('eye', pa.eyes(iris))
    pt.set('lips', pa.lips(lips))
    pt.set('hair', pa.hair(hair))


def courier(pose=None):
    """Our delivery rider: amber helmet, charcoal polo with an amber yoke and badge, insulated backpack."""
    b = an.Build('m', 1.76)
    sk, fig, pt = _base(b, pose)
    wd.top(fig, b, 'shirt', sleeve=0.5, collar='polo')
    wd.trousers(fig, b, 'pants', loose=0.009)
    wd.shoes(fig, b)
    wd.hair_short(fig, b)
    wd.helmet(fig, b)
    wd.backpack(fig, b)
    _face(pt, 'olive', stubble=0.4)
    yoke = lambda P, p: pa.smoothstep(0.165, 0.172, p.local('chest', P)[:, 1])
    shirt = pa.two_tone(CHAR, AMBER, yoke)
    shirt = pa.decal(shirt, 'badge.png', 'chest', [0.075, 0.105, 0.11], [-1, 0, 0], [0, 1, 0], (0.075, 0.075), depth=0.05, facing=[0, 0, 1])
    pt.set('shirt', shirt)
    pt.set('pants', pa.fabric('#2c3139', stretch=(1, 2, 1)))
    pt.set('shoes', pa.solid('#e6e3dc', 0.04))
    pt.set('sole', pa.solid('#2b2b2c', 0.05))
    stripe = lambda P, p: pa.smoothstep(0.016, 0.012, np.abs(p.local('head', P)[:, 0]))
    pt.set('helmet', pa.decal(pa.two_tone(AMBER, '#1d1f23', stripe), 'helmet.png', 'head', [0.105, 0.1, -0.02], [0, 0, -1], [0, 1, 0],
                              (0.07, 0.07), depth=0.04, facing=[1, 0, 0]))
    pt.set('visor', pa.solid('#1d1f23', 0.03))
    pt.set('bag', pa.decal(pa.solid(AMBER, 0.04), 'back.png', 'chest', [0, b.bag_centre[1], b.bag_back], [-1, 0, 0], [0, 1, 0],
                           (0.3, 0.3), depth=0.06, facing=[0, 0, -1]))
    pt.set('bagtop', pa.solid('#1d1f23', 0.04))
    pt.set('strap', pa.solid('#1d1f23', 0.04))
    return b, sk, fig, pt


def staff(pose=None):
    """Restaurant staff: cream headscarf, light-blue shirt, black apron, holding foil food trays."""
    b = an.Build('f', 1.64, hips=1.02)
    sk, fig, pt = _base(b, pose or (lambda sk, b: st.carry(sk, b, height=-0.27, depth=0.3, width=0.12)), jaw=0.95, lips=1.05)
    wd.top(fig, b, 'shirt', sleeve=1.88, collar='crew', tuck=True, loose=0.012)
    wd.trousers(fig, b, 'pants', loose=0.012)
    wd.apron(fig, b)
    wd.shoes(fig, b, 'flat')
    wd.hijab(fig, b)
    wd.foil_trays(fig, b)
    _face(pt, 'light', iris='#3b2a1c', lips='#b0635c', brows='#2b1c14', brow_w=0.85)
    pt.set('shirt', pa.fabric('#7fa6d6'))
    pt.set('pants', pa.fabric('#25272b'))
    pt.set('apron', pa.solid('#1c1d20', 0.05))
    pt.set('shoes', pa.solid('#1b1b1c', 0.05))
    pt.set('sole', pa.solid('#141414', 0.05))
    pt.set('scarf', pa.fabric('#4d5a6e', 0.06))
    pt.set('foil', pa.solid('#c6c9cd', 0.12, 80))
    pt.set('lid', pa.solid('#d7d9db', 0.06, 60))
    return b, sk, fig, pt


def pizza_carrier(pose=None):
    """Pizza shop runner: red polo and cap, jeans, three boxes."""
    b = an.Build('m', 1.74, muscle=0.95)
    sk, fig, pt = _base(b, pose or (lambda sk, b: st.carry(sk, b, height=-0.29, depth=0.31, width=0.15)), nose=1.03)
    wd.top(fig, b, 'shirt', sleeve=0.5, collar='polo')
    wd.trousers(fig, b, 'pants', loose=0.01)
    wd.shoes(fig, b)
    wd.hair_short(fig, b)
    wd.cap(fig, b)
    wd.pizza_boxes(fig, b)
    _face(pt, 'tan', stubble=0.25)
    pt.set('shirt', pa.fabric('#b3302a'))
    pt.set('pants', pa.denim('#34506f'))
    pt.set('shoes', pa.solid('#e9e6e0', 0.04))
    pt.set('sole', pa.solid('#2a2a2a', 0.05))
    pt.set('cap', pa.solid('#b3302a', 0.05))
    c = b.prop_centre
    pt.set('kraft', pa.decal(pa.solid('#b8875a', 0.05), 'pizza.png', 'world', [c[0], c[1] - 0.001, c[2]], [1, 0, 0], [0, 0, -1],
                             (0.26, 0.26), depth=0.012, facing=[0, 1, 0]))
    return b, sk, fig, pt


def kurdish_man(pose=None):
    """Older man in shal u shapik with a patterned sash and a jamana headwrap."""
    b = an.Build('m', 1.72, belly=0.6, muscle=0.95)
    sk, fig, pt = _base(b, pose or (lambda sk, b: st.idle(sk, b, bend=14, variant=1)), brow=1.1, nose=1.08, jaw=1.03)
    wd.top(fig, b, 'kurdi', sleeve=1.93, collar='crew', loose=0.015, hem=-0.13)
    wd.sharwal(fig, b)
    wd.sash(fig, b)
    wd.shoes(fig, b, 'flat')
    wd.jamana(fig, b)
    wd.moustache(fig, b, full=1.15)
    _face(pt, 'tan', stubble=0.15, brows='#6d665e', hair='#8b857d', iris='#3a2a1c')
    pt.set('kurdi', pa.fabric('#6c6455', 0.07))
    stripes = lambda P, p: (np.sin(p.local('pelvis', P)[:, 1] * 260) > 0.2).astype(float)
    pt.set('sash', pa.two_tone('#7a2b25', '#c9a24a', stripes))
    pt.set('shoes', pa.solid('#3a2a20', 0.05))
    pt.set('sole', pa.solid('#1e1712', 0.05))

    def jam(P, p):
        q = p.local('head', P)
        ang = np.arctan2(q[:, 0], q[:, 2])
        chk = ((np.floor(ang * 9) + np.floor(q[:, 1] * 120)) % 2).astype(float)
        return chk
    pt.set('turban', pa.two_tone('#1b1b1c', '#e8e3d9', jam))
    return b, sk, fig, pt


def young_man(pose=None):
    """Student in an olive hoodie and jeans."""
    b = an.Build('m', 1.78, muscle=0.92, shoulders=0.98)
    sk, fig, pt = _base(b, pose or (lambda sk, b: st.idle(sk, b, bend=12, variant=-1)), nose=0.97, jaw=0.97)
    wd.top(fig, b, 'shirt', sleeve=1.9, collar=None, loose=0.017, hem=-0.07)
    wd.hood(fig, b)
    wd.trousers(fig, b, 'pants', loose=0.011)
    wd.shoes(fig, b)
    wd.hair_short(fig, b, length=0.009, top=0.016)
    _face(pt, 'olive', stubble=0.3)
    pt.set('shirt', pa.fabric('#56634a', 0.07))
    pt.set('pants', pa.denim('#2f4a6e'))
    pt.set('shoes', pa.solid('#ece9e3', 0.04))
    pt.set('sole', pa.solid('#ece9e3', 0.04))
    return b, sk, fig, pt


def woman_coat(pose=None):
    """Woman in a long navy coat and a dusty-pink headscarf."""
    b = an.Build('f', 1.63)
    sk, fig, pt = _base(b, pose or (lambda sk, b: st.idle(sk, b, bend=12, abduct=9)), jaw=0.94, lips=1.05)
    wd.trousers(fig, b, 'pants', loose=0.01)
    wd.coat(fig, b)
    wd.shoes(fig, b, 'flat')
    wd.hijab(fig, b)
    _face(pt, 'light', iris='#2e2116', lips='#a8605c', brows='#24180f', brow_w=0.8)
    pt.set('coat', pa.fabric('#2c3a55', 0.06))
    pt.set('pants', pa.fabric('#1d1e22'))
    pt.set('shoes', pa.solid('#2a1f1a', 0.05))
    pt.set('sole', pa.solid('#141414', 0.05))
    pt.set('scarf', pa.fabric('#c4919a', 0.06))
    return b, sk, fig, pt


def worker(pose=None):
    """Factory and warehouse worker: high-visibility vest, hard hat, boots."""
    b = an.Build('m', 1.75, muscle=1.05, belly=0.3)
    sk, fig, pt = _base(b, pose or (lambda sk, b: st.idle(sk, b, bend=10, variant=1)), jaw=1.05)
    wd.top(fig, b, 'shirt', sleeve=1.9, collar='crew', loose=0.012)
    wd.vest(fig, b)
    wd.trousers(fig, b, 'pants', loose=0.014)
    wd.shoes(fig, b, 'boot')
    wd.hardhat(fig, b)
    _face(pt, 'tan', stubble=0.45)
    pt.set('shirt', pa.fabric('#5a6068'))
    bands = lambda P, p: ((np.abs(p.local('chest', P)[:, 1] + 0.02) < 0.018) | (np.abs(p.local('pelvis', P)[:, 1] - 0.09) < 0.018)).astype(float)
    pt.set('vest', pa.two_tone('#c9d62a', '#b9bec4', bands))
    pt.set('pants', pa.fabric('#2a3346'))
    pt.set('shoes', pa.solid('#4a3626', 0.06))
    pt.set('sole', pa.solid('#1c1c1c', 0.05))
    pt.set('hardhat', pa.solid('#f1efe9', 0.03))
    return b, sk, fig, pt


def dispatcher(pose=None):
    """Kak Hama, the dispatcher (portrait): branded polo, headset, moustache."""
    b = an.Build('m', 1.74, belly=0.5)
    sk, fig, pt = _base(b, pose or (lambda sk, b: st.idle(sk, b, bend=12)), brow=1.05, nose=1.05, jaw=1.04)
    wd.top(fig, b, 'shirt', sleeve=0.5, collar='polo')
    wd.trousers(fig, b, 'pants')
    wd.shoes(fig, b)
    wd.hair_short(fig, b, length=0.005, front=0.17)
    wd.moustache(fig, b)
    wd.headset(fig, b)
    _face(pt, 'olive', stubble=0.3, hair='#2b2724', brows='#2a2420')
    yoke = lambda P, p: pa.smoothstep(0.165, 0.172, p.local('chest', P)[:, 1])
    shirt = pa.decal(pa.two_tone(CHAR, AMBER, yoke), 'badge.png', 'chest', [0.075, 0.105, 0.11], [-1, 0, 0], [0, 1, 0], (0.075, 0.075),
                     depth=0.05, facing=[0, 0, 1])
    pt.set('shirt', shirt)
    pt.set('pants', pa.fabric('#2c3139'))
    pt.set('shoes', pa.solid('#2a2a2a'))
    pt.set('sole', pa.solid('#1a1a1a'))
    pt.set('headset', pa.solid('#1a1b1d', 0.04))
    return b, sk, fig, pt


CAST = {
    'staff': staff,
    'pizza_carrier': pizza_carrier,
    'kurdish_man': kurdish_man,
    'young_man': young_man,
    'woman_coat': woman_coat,
    'worker': worker,
}
