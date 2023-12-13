import {exiftool} from 'exiftool-vendored'
import {readFileSync} from 'fs'
const p = JSON.parse(readFileSync('./package.json'))


console.log(`Semantic NFT \tv${p.version}`)
exiftool
    .version()
    .then((version) => console.log(`ExifTool \tv${version}`))
    .finally(() => exiftool.end())
