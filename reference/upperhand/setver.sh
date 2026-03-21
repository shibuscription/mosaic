#!/bin/sh
set -e

[ $1 ] || (echo "Usage: $0 version"; exit 1)

version=`echo $1 | sed 's/^[^0-9]*//'`

[ $version ] && npx semver $version || (echo "${version}: bad semver"; exit 1)

ex package.json <<++
    /"version":/s/: .*$/: "${version}",/
    /"build:css":/s/upperhand[^ ]*\.css/upperhand-${version}.css/
    w!
++

ex package-lock.json <<++
    1,9s/"version":.*,/"version": "${version}",/
    w!
++

ex src/js/index.js <<++
    2s/v.*/v${version}/
    w!
++

ex src/html/index.pug <<++
    1s/version.*/version = \'${version}\'/
    w!
++
