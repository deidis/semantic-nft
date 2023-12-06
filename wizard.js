const {ExifTool} = require('exiftool-vendored')
const {collect} = require('./src/collect')
const {cleanup} = require('./src/cleanup')

const args = process.argv.slice(2)

if (args.length === 0) {
  console.log('Please provide a path to the artwork file, multiple files or a directory.')
  process.exit(1)
}


const files = []
args.forEach((arg) => {
  // It's very likely that media files are organized in subfolders,
  // so we need to collect them recursively at least one level deep.
  const recursionLevel = 1
  files.push(...collect(arg, recursionLevel))
})

if (files.length > 0) {
  console.log(`Processing ${files.length} files.`)
  const exiftool = new ExifTool({taskTimeoutMillis: 10000})

  cleanup(exiftool, files).finally(() => {
    exiftool.end(true)
  })
} else {
  console.log('No files found to process')
}
