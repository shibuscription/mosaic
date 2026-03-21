/*
 *  Controller
 */

"use strict";

const $ = require('jquery');
const Board = require('./board');

module.exports = class Controller {

    constructor(root, game, r, callback) {
        this._root  = root;
        this._game  = game;
        this._board = new Board(root, game, r);
        this._callback = callback;

        this._root.off('click');
        this._board.redraw();
    }

    start(...players) {

        this._selectMove = [];

        for (let i of [ 1, 2 ]) {
            const player = players.shift();
            if (player) {
                this._selectMove[i] = ()=> setTimeout(
                    ()=> this.move(player.selectMove()), 10);
            }
            else {
                this._selectMove[i] = ()=>{
                    for (let p = 0; p < this._game.length; p++) {
                        if (this._game.status(p) == -1) {
                            this._board.status[p].on('click', ()=>{
                                this._board.status.forEach(s => s.off('click'));
                                this.move(p);
                                this.next();
                                return false;
                            });
                        }
                    }
                };
            }
        }

        this._moved = true;
        this.next();
    }

    stop() {
        this._stop = true;
    }

    next(start) {
        if (this._timeoutID) this._timeoutID = clearTimeout(this._timeoutID);
        if (start) this._stop = false;
        if (this._stop) return;
        if (! this._moved) return;

        this._board.redraw();
        if (! this._game.next) {
            this._root.on('click', ()=> this._callback());
            return;
        }

        this._moved = false;
        this._selectMove[this._game.next]();
        this._timeoutID = setTimeout(()=> this.next(), 1000);
    }

    move(p) {
        this._moved = true;
        this._game.makeMove(p);
        if (! this._timeoutID)
            this._timeoutID = setTimeout(()=> this.next(), 0);
    }
}
