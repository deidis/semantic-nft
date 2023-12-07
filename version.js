import {exiftool} from 'exiftool-vendored'
exiftool
    .version()
    .then((version) => console.log(`ExifTool v${version}`))
    .finally(() => exiftool.end())
