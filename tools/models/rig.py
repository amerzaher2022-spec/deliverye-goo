"""Write the bone positions of each townsperson to web/public/models/people.rig.json.

The game skins the baked people (people.glb) at load time so they can walk, dodge and wave: it needs to
know where each figure's joints are. These come straight from the skeletons the figures were sculpted
around (cast.py), in the pose they were baked in, so the bones sit exactly inside the meshes.

Run (no Blender needed): python3 tools/models/rig.py   (needs numpy, scipy, scikit-image, pillow)
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cast  # noqa: E402

# the body without fingers: enough for walking and gestures, few enough bones for phones
BONES = ['pelvis', 'spine', 'chest', 'neck', 'head',
         'clav.L', 'uarm.L', 'farm.L', 'hand.L', 'clav.R', 'uarm.R', 'farm.R', 'hand.R',
         'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R']


def main():
    out = {}
    for name, fn in cast.CAST.items():
        b, sk, fig, pt = fn()
        bones = []
        for n in BONES:
            W = sk.world(n)
            head = W[:3, 3]
            tail = head + W[:3, :3] @ np.array([0, sk.bones[n]['length'], 0])
            bones.append(dict(name=n, parent=sk.bones[n]['parent'], head=[round(float(v), 4) for v in head],
                              tail=[round(float(v), 4) for v in tail]))
        out[name] = bones
    path = os.path.join(HERE, '..', '..', 'web', 'public', 'models', 'people.rig.json')
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', os.path.abspath(path))


if __name__ == '__main__':
    main()
