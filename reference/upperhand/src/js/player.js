/*
 *  Player
 */

"use strict";

function getWeight(game) {
    let weight = [];
    for (let p = 0; p < game.length; p++) {
        let pos = [], w = 0;
        pos[p] = true;
        for (let q = game.size * game.size ; q < game.length; q++) {
            for (let c of game.child(q)) {
                if (pos[c]) {
                    pos[q] = true;
                    w++;
                    break;
                }
            }
        }
        weight[p] = w;
    }
    return weight;
}

function makePriorityOfPosition(game) {
    const weight = getWeight(game);
    let position = [];
    for (let p = 0; p < game.length; p++) position[p] = p;
    for (let i = position.length; i > 0; i--) {
        let j = (Math.random() * i)|0;
        [ position[i-1], position[j] ] = [ position[j], position[i-1] ];
    }
    return position.sort((a, b)=> weight[b] - weight[a]);
}

function getValue(game) {
    if (! game.next) {
        return game.length / 2 - game.ball(1) + game.ball(2);
    }
    else {
        let ev = [], rv = 0;
        for (let p = 0; p < game.length; p++) {
            if      (game.status(p) == -1) ev[p] = 0.5;
            else if (game.status(p) ==  0) ev[p] = 0.5;
            else if (game.status(p) ==  1) ev[p] = 1.0;
            else if (game.status(p) ==  2) ev[p] = 0.0;
            else {
                let [ e1, e2, e3, e4 ] = game.child(p).map(q => ev[q]);
                ev[p] = e1 * e2 * e3 * e4
                      + (1 - e1) * e2 * e3 * e4
                      + e1 * (1 - e2) * e3 * e4
                      + e1 * e2 * (1 - e3) * e4
                      + e1 * e2 * e3 * (1 - e4)
                      + (1 - e1) * (1 - e2) * e3 * e4 * 0.5
                      + (1 - e1) * e2 * (1 - e3) * e4 * 0.5
                      + (1 - e1) * e2 * e3 * (1 - e4) * 0.5
                      + e1 * (1 - e2) * (1 - e3) * e4 * 0.5
                      + e1 * (1 - e2) * e3 * (1 - e4) * 0.5
                      + e1 * e2 * (1 - e3) * (1 - e4) * 0.5;
            }
            rv += ev[p];
        }
        return rv;
    }
}

function evaluate(game, player, depth, position, a, b) {

    if (! game.next || ! depth) {
        return player == 1
                    ? getValue(game)
                    : game.length - getValue(game);
    }

    let max = a, min = b;
    for (let p of position) {
        if (game.status(p) != -1) continue;
        let ev = evaluate(game.clone().makeMove(p),
                                player, depth - 1, position,
                                max, min);
        if (game.next == player) {
            if (ev >= b) return b;
            max = ev > max ? ev : max;
        }
        else {
            if (ev <= a) return a;
            min = ev < min ? ev : min;
        }
    }
    return game.next == player ? max : min;
}

module.exports = class Player {

    constructor(game, level = 2) {
        this._game = game;
        this._level = level;
        this._posision = makePriorityOfPosition(game);
    }

    depth() {
        if (! this._game._status.find(s=> s == 2)) return 0;
        if (this._level < 3) return this._level;
        return Math.max((50 / (this._game.moves().length))|0, 3);
    }

    selectMove() {

        let depth = this.depth();

        if (! depth) {
            for (let p of this._posision) {
                if (this._game.status(p) == -1) return p;
            }
            return;
        }

        let rv, max = 0, min = this._game.length;
        for (let p of this._posision) {
            if (this._game.status(p) != -1) continue;
            let ev = evaluate(this._game.clone().makeMove(p),
                                this._game.next, depth - 1, this._posision,
                                max, min);
            if (ev > max) {
                max = ev;
                rv  = p;
            }
        }
        return rv;
    }
}
