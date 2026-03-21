/*!
 *  UpperHand Game v1.0.2
 *
 *  Copyright(C) 2023 Satoshi Kobayashi
 *  Released under the MIT license
 *  https://github.com/kobalab/UpperHand/blob/master/LICENSE
 */

const $ = require('jquery');
const Game       = require('./game');
const Player     = require('./player');
const Controller = require('./controller');

$(function(){

    let [ size, level, turn ] = location.hash.replace(/^#/,'').split('/');

    size = + size || 5;
    size = size < 3  ?  3
         : size > 11 ? 11
         :             size;

    turn  = + turn  || 1;
    level = level == '0' ? 0 : + level || 2;

    if (turn == 3) {
        $('select[name="turn"] option:not([value="3"])').remove();
    }
    else {
        $('select[name="turn"] option[value="3"]').remove();
    }

    let pref = JSON.parse(localStorage.getItem('UpperHand.pref')||'{}');
    size  = pref.size ?? size;
    level = pref.level ?? level;

    let ctrl;

    function start() {

        $('#pref').hide();
        $('#rule').hide();

        let r = Math.min((($('body').width() - 40) / size / 2)|0, 24);

        const game = new Game(size);
        ctrl = new Controller($('#board'), game, r, start);
        if      (level == 0) ctrl.start(null, null);
        else if (turn  == 1) ctrl.start(null, new Player(game, level - 1));
        else if (turn  == 2) ctrl.start(new Player(game, level - 1), null);
        else                 ctrl.start(new Player(game, level - 1),
                                        new Player(game, level - 1));

        $('#board').fadeIn();
    }

    function submit() {
        size  = + $('select[name="size"]').val();
        level = + $('select[name="level"]').val();
        turn  = + $('select[name="turn"]').val();
        localStorage.setItem(
            'UpperHand.pref', JSON.stringify({ size: size, level: level }));

        start();

        return false;
    }

    function reset() {
        $('#pref').hide();
        $('#rule').hide();
        $('#board').show();

        if (ctrl) ctrl.next(true);

        $('select[name="size"]').val(size);
        $('select[name="level"]').val(level);
        $('select[name="turn"]').val(turn);
        return false;
    }

    $('a[href="#pref"]').on('click', ()=>{
        $('#board').hide();
        $('#rule').hide();
        $('#pref').slideDown();
        if (ctrl) ctrl.stop();
        return false;
    });
    $('a[href="#rule"]').on('click', ()=>{
        $('#board').hide();
        $('#pref').hide();
        $('#rule').slideDown();
        if (ctrl) ctrl.stop();
        return false;
    });

    $('form').on('submit', submit);
    $('form').on('reset',  reset);

    reset();
    start();
});
