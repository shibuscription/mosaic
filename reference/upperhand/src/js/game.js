/*
 *  Game
 */

"use strict";

module.exports = class Game {

    constructor(size = 5) {
        this._size = size;
        this._child  = [];
        this._status = [];

        let c = ((size / 2)|0) * (size % 2);
        for (let z = size; z > 0; z--) {
            let base = this._child.length - (z + 1) * (z + 1);
            for (let y = 0; y < z; y++) {
                for (let x = 0; x < z; x++) {
                    if (base < 0) {
                        this._child.push([-1,-1,-1,-1]);
                    }
                    else {
                        this._child.push([
                            base + y       * (z + 1) + x,
                            base + y       * (z + 1) + x + 1,
                            base + (y + 1) * (z + 1) + x,
                            base + (y + 1) * (z + 1) + x + 1
                        ]);
                    }
                    if (base < 0) {
                        if (c && x == c && y == c)  this._status.push(0);
                        else                        this._status.push(-1);
                    }
                    else {
                        this._status.push(null);
                    }
                }
            }
        }

        this._ball = [];
        this._ball[0] = c ? 1 : 0;
        this._ball[1] = (this._status.length + 1 - this._ball[0])/2|0;
        this._ball[2] = this._status.length - this._ball[0] - this._ball[1];

        this._next = 1;
    }

    clone() {
        const obj = new Game(this.size);
        obj._status = this._status.concat();
        obj._ball   = this._ball.concat();
        obj._next   = this._next;
        return obj;
    }

    get length() { return this._status.length }
    get size()   { return this._size }
    get next() {
        if (this._ball[1] == 0 || this._ball[2] == 0) return;
        return this._next;
    }

    status(p) { return this._status[p] }
    child(p)  { return this._child[p]  }
    ball(player) { return this._ball[player] }

    moves() {
        return this._status.map((s, p)=> s == -1 ? p : -1)
                           .filter(p=> p >= 0);
    }

    makeMove(p) {
        const put = (p, player)=>{
            if (this._ball[player] > 0) {
                this._ball[player]--;
                this._status[p] = player;
            }
        };
        let next = this.next;
        if (! next) throw Error(this);
        if (this._status[p] != -1) throw Error([this, p]);
        put(p, next);
        for (let q = 0; q < this._status.length; q++) {
            if (this._status[q] != null) continue;
            let n0 = 0, n1 = 0, n2 = 0;
            for (let c of this._child[q]) {
                if      (this._status[c] == 0) n0++;
                else if (this._status[c] == 1) n1++;
                else if (this._status[c] == 2) n2++;
            }
            if (n0 + n1 + n2 < 4) continue;
            if      (n1 >= 3) put(q, 1);
            else if (n2 >= 3) put(q, 2);
            else              this._status[q] = -1;
        }
        this._next = this._next == 1 ? 2 : 1;
        return this;
    }

    toString() {
        let str = '';
        let p = 0;
        for (let z = this.size; z > 0; z--) {
            for (let y = 0; y < z; y++) {
                for (let x = 0; x < z; x++) {
                    str += this._status[p] == 0 ? '+'
                         : this._status[p] == 1 ? 'o'
                         : this._status[p] == 2 ? 'x'
                         :                        '.';
                    p++;
                }
                str += '\n';
            }
            str += '\n';
        }
        return str;
    }
}
