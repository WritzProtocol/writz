'use strict';
const { poseidonHash, prove, verify } = require('./helpers');

const DEPTH = 20;

/** A depth-20 Poseidon tree over `leaves`, with `pathFor(index)`. */
async function buildTree(leaves) {
    const zeros = [0n];
    for (let i = 1; i <= DEPTH; i++) zeros[i] = await poseidonHash([zeros[i - 1], zeros[i - 1]]);

    const levels = [leaves.slice()];
    for (let d = 0; d < DEPTH; d++) {
        const level = levels[d];
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
            next.push(await poseidonHash([level[i], i + 1 < level.length ? level[i + 1] : zeros[d]]));
        }
        levels.push(next);
    }
    const root = leaves.length === 0 ? zeros[DEPTH] : levels[DEPTH][0];

    function pathFor(index) {
        const elements = [];
        let idx = index;
        for (let d = 0; d < DEPTH; d++) {
            const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
            elements.push(sibling < levels[d].length ? levels[d][sibling] : zeros[d]);
            idx = Math.floor(idx / 2);
        }
        return elements;
    }
    return { root, pathFor };
}

function insertInput({ oldRoot, commitment, index, pathElements }) {
    return {
        old_root:      String(oldRoot),
        commitment:    String(commitment),
        leaf_index:    String(index),
        path_elements: pathElements.map(String),
    };
}

describe('insert circuit', () => {
    test('appending to the next empty leaf proves, and new_root is the real tree root', async () => {
        const leaves = [11n, 22n, 33n];
        const before = await buildTree(leaves);
        const after = await buildTree([...leaves, 44n]);

        const { proof, publicSignals } = await prove('insert', insertInput({
            oldRoot: before.root, commitment: 44n, index: 3, pathElements: before.pathFor(3),
        }));
        expect(await verify('insert', proof, publicSignals)).toBe(true);
        // [new_root, old_root, commitment, leaf_index]
        expect(publicSignals.map(BigInt)).toEqual([after.root, before.root, 44n, 3n]);
    });

    test('the first insertion into the empty tree proves', async () => {
        const empty = await buildTree([]);
        const after = await buildTree([7n]);
        const { publicSignals } = await prove('insert', insertInput({
            oldRoot: empty.root, commitment: 7n, index: 0, pathElements: empty.pathFor(0),
        }));
        expect(BigInt(publicSignals[0])).toBe(after.root);
    });

    test('overwriting an occupied leaf cannot be proven', async () => {
        // Replacing someone's position with an attacker-chosen leaf: the old
        // leaf at index 1 is 22, not 0, so the empty-slot check fails.
        const tree = await buildTree([11n, 22n, 33n]);
        await expect(prove('insert', insertInput({
            oldRoot: tree.root, commitment: 99n, index: 1, pathElements: tree.pathFor(1),
        }))).rejects.toThrow();
    });

    test('a path that does not match leaf_index cannot be proven', async () => {
        // The path for slot 3 claimed as slot 5: the index bits drive the
        // hashing order, so the recomputed old root no longer matches.
        const tree = await buildTree([11n, 22n, 33n]);
        await expect(prove('insert', insertInput({
            oldRoot: tree.root, commitment: 44n, index: 5, pathElements: tree.pathFor(3),
        }))).rejects.toThrow();
    });

    test('an old_root other than the real tree root cannot be proven', async () => {
        const tree = await buildTree([11n, 22n, 33n]);
        await expect(prove('insert', insertInput({
            oldRoot: tree.root + 1n, commitment: 44n, index: 3, pathElements: tree.pathFor(3),
        }))).rejects.toThrow();
    });

    test('a leaf_index of 2^20 or more cannot be proven', async () => {
        const tree = await buildTree([]);
        await expect(prove('insert', insertInput({
            oldRoot: tree.root, commitment: 44n, index: 2 ** 20, pathElements: tree.pathFor(0),
        }))).rejects.toThrow();
    });

    test('a tampered new_root does not verify', async () => {
        const tree = await buildTree([11n]);
        const { proof, publicSignals } = await prove('insert', insertInput({
            oldRoot: tree.root, commitment: 22n, index: 1, pathElements: tree.pathFor(1),
        }));
        const forged = [String(BigInt(publicSignals[0]) + 1n), ...publicSignals.slice(1)];
        expect(await verify('insert', proof, forged)).toBe(false);
    });
});
