const assert  = require('assert');

const Game = require('../src/js/game');

suite('Game', ()=>{

    test('クラスが存在すること', ()=> assert.ok(Game));

    suite('constructor()', ()=>{
        const game = new Game();
        test('インスタンスが生成できること', ()=> assert.ok(game));
        test('デフォルトは5路盤であること', ()=> assert.equal(game.size, 5));
        test('親子階層が正しいこと', ()=> {
            const CHILD = [
                [-1,-1,-1,-1],  //  0
                [-1,-1,-1,-1],  //  1
                [-1,-1,-1,-1],  //  2
                [-1,-1,-1,-1],  //  3
                [-1,-1,-1,-1],  //  4
                [-1,-1,-1,-1],  //  5
                [-1,-1,-1,-1],  //  6
                [-1,-1,-1,-1],  //  7
                [-1,-1,-1,-1],  //  8
                [-1,-1,-1,-1],  //  9
                [-1,-1,-1,-1],  // 10
                [-1,-1,-1,-1],  // 11
                [-1,-1,-1,-1],  // 12
                [-1,-1,-1,-1],  // 13
                [-1,-1,-1,-1],  // 14
                [-1,-1,-1,-1],  // 15
                [-1,-1,-1,-1],  // 16
                [-1,-1,-1,-1],  // 17
                [-1,-1,-1,-1],  // 18
                [-1,-1,-1,-1],  // 19
                [-1,-1,-1,-1],  // 20
                [-1,-1,-1,-1],  // 21
                [-1,-1,-1,-1],  // 22
                [-1,-1,-1,-1],  // 23
                [-1,-1,-1,-1],  // 24

                [ 0, 1, 5, 6],  // 25
                [ 1, 2, 6, 7],  // 26
                [ 2, 3, 7, 8],  // 27
                [ 3, 4, 8, 9],  // 28
                [ 5, 6,10,11],  // 29
                [ 6, 7,11,12],  // 30
                [ 7, 8,12,13],  // 31
                [ 8, 9,13,14],  // 32
                [10,11,15,16],  // 33
                [11,12,16,17],  // 34
                [12,13,17,18],  // 35
                [13,14,18,19],  // 36
                [15,16,20,21],  // 37
                [16,17,21,22],  // 38
                [17,18,22,23],  // 39
                [18,19,23,24],  // 40

                [25,26,29,30],  // 41
                [26,27,30,31],  // 42
                [27,28,31,32],  // 43
                [29,30,33,34],  // 44
                [30,31,34,35],  // 45
                [31,32,35,36],  // 46
                [33,34,37,38],  // 47
                [34,35,38,39],  // 48
                [35,36,39,40],  // 49

                [41,42,44,45],  // 50
                [42,43,45,46],  // 51
                [44,45,47,48],  // 52
                [45,46,48,49],  // 53

                [50,51,52,53],  // 54
            ];
            for (let p = 0; p < game._child.length; p++) {
                assert.deepEqual(game.child(p), CHILD[p], p);
            }
        });
        test('玉の初期状態が正しいこと', ()=>{
            const STATUS = [
                 -1,-1,-1,-1,-1,
                 -1,-1,-1,-1,-1,
                 -1,-1, 0,-1,-1,
                 -1,-1,-1,-1,-1,
                 -1,-1,-1,-1,-1,
                 null, null, null, null,
                 null, null, null, null,
                 null, null, null, null,
                 null, null, null, null,
                 null, null, null,
                 null, null, null,
                 null, null, null,
                 null, null,
                 null, null,
                 null
             ];
            for (let p = 0; p < game._status.length; p++) {
                assert.equal(game.status(p), STATUS[p], p);
            }
        });
        test('残り玉数が正しいこと', ()=>{
            assert.equal(game.ball(1), 27);
            assert.equal(game.ball(2), 27);
        });
        test('手番の初期値が正しいこと', ()=>
            assert.equal(game.next, 1));
        test('有効な手の初期値が正しいこと', ()=>
            assert.deepEqual(game.moves(), [
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                13, 14, 15, 16, 17, 18 , 19, 20, 21, 22, 23, 24
            ]));
        test('6路盤が生成できること', ()=>{
            const game = new Game(6);
            assert.ok(game);
            assert.equal(game.size, 6);
            assert.equal(game.status(36), null);
            assert.equal(game.child(36)[0], 0);
            assert.equal(game.ball(0), 0);
            assert.equal(game.ball(1), 46);
            assert.equal(game.ball(2), 45);
        });
        test('7路盤が生成できること', ()=>{
            const game = new Game(7);
            assert.ok(game);
            assert.equal(game.size, 7);
            assert.equal(game.status(49), null);
            assert.equal(game.child(49)[0], 0);
            assert.equal(game.ball(0), 1);
            assert.equal(game.ball(1), 70);
            assert.equal(game.ball(2), 69);
        });
    });

    suite('makeMove', ()=>{
        const game = new Game();
        test('玉が置けること', ()=>{
            game.makeMove(7);
            assert.equal(game.status(7), 1);
        });
        test('2段目に玉が置けるようになること', ()=>{
            game.makeMove(13);
            assert.equal(game.status(31), null);
            game.makeMove(8);
            assert.equal(game.status(31), -1);
        });
        test('ボーナス玉が置かれること', ()=>{
            game.makeMove(3);
            assert.equal(game.status(27), null);
            game.makeMove(2);
            assert.equal(game.status(27), 1);
        });
        test('ボーナス玉が連続して置かれること');
        test('玉がない場合ボーナス玉の処理を終えること');
        test('ゲーム終了後は玉が置けないこと');
    });
});
