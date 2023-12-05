const ExifTool = require("exiftool-vendored").ExifTool
const exiftool = new ExifTool({ taskTimeoutMillis: 5000 })
exiftool
    .version()
    .then((version) => console.log(`ExifTool v${version}`))

exiftool.end(true)