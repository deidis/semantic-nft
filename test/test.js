import {exiftool} from 'exiftool-vendored'
import assert from 'assert'
import {calculateCID} from '../src/ipfs.js'

describe('ExifTool version', function() {
  const expectedVersion = '12.70'

  it(`should be ${expectedVersion} or later`, async function() {
    const version = await exiftool.version()
    assert.equal(parseFloat(version) >= parseFloat(expectedVersion), true)
  })

  after(function() {
    exiftool.end()
  })
})

// describe('TOML vocabulary', function() {
//   const tomlFile = fs.readFileSync('nft-workspace/example-project/art-metadata.toml', 'utf8')
//   const exampleProjectDescriptor = TOML.parse(tomlFile)
//   console.log(exampleProjectDescriptor)
// })

describe('File on IPFS', function() {
  it(`a known file on IPFS should have a known immutable CID`, async function() {
    // You can upload the file on some pinning service, and you'll have this CID, hence I'm hardcoding it here
    const cid = 'bafybeia2tcrp6lr7r3bn2d5degyzd3vwrfdfhxy4bkrao66fx63f2j5t6u'
    const result = await calculateCID('nft-workspace/example-project/square.jpg')
    assert.equal(result, cid)
  })
})
