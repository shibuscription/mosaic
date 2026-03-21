const version = require('./package.json').version;

const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
    entry:  {
        upperhand:  './src/js/index.js',
    },
    output: {
        path:     __dirname + '/dist/',
        filename: `[name]-${version}.js`
    },
    optimization: {
        minimizer: [ new TerserPlugin({extractComments: false}) ],
    },
};
