# Semantic NFT

This project is an implementation of the metadata management architecture of digital assets proposed in
[this documentation by silvermind.art](https://docs.silvermind.art/fundamentals/digital-asset).

## Installation

```bash
pnpm install
```

## Usage

Check the version of the exiftool that's in use (and in general if the code works):

```bash
pnpm run version
```

### Metadata management

We use [TOML](https://toml.io/en/) for collecting metadata that we will need to create the NFT.

#### TOML for artwork metadata
In the context of an artwork metadata (as we want to put correct things into the image itself) we prescribe the tags in one or more `.toml` files.

In [Silvermind docs](https://docs.silvermind.art/fundamentals/digital-asset/artwork-metadata) we describe how we use XMP-dc (Dublin Core vocabulary) and a bit of Exif vocabulary to add the semantic metadata to the image. To make it even simpler, in the `.toml` file we assume that the group of the vocabulary is always "XMP-dc" unless specified otherwise. Check the [example project](./nft-workspace/example-project) for how to add/clear tags.

Behind the scenes we use [ExifTool](https://exiftool.org). The main thing to remember is that ExifTool prioritizes groups like this: 1) EXIF, 2) IPTC, 3) XMP. Whereas, we prioritize like this: 1) XMP-dc 2) XMP-xmpRights 3) EXIF 4) IPTC, 5) XMP other.

By the way, ExifTool processes tags case-insensitive, so no stress when writing `.toml`. However internally we transform all the tags. Cases for vocabularies (groups) that we use:
- XMP-dc
- XMP-xmpRights
- exif
- IPTC
- XMP

Example 1:

```toml
["artwork.png"]
ImageDescription = "ImageDescription field"
```

```toml
["artwork.png"]
title = "title field"
```

According to Silvermind we put the same value into XMP-dc:Title and exif:ImageDescription, therefore both `.toml` files will bring us to the same result, i.e. that both tags will have the same value.

Example 2:

```toml
["artwork.png"]
"exif:ImageDescription" = "ImageDescription field"
```

```toml
["artwork.png"]
"XMP-dc:title" = "title field"
```

Now we specify the group and therefore after running both files we actually set only specific field in each case. 


**IMPORTANT** Please note that some of the metadata, such as the URI of the certificate of authenticity, identifier, etc. might not be available untl the moment when the NFT is minted. Therefore, be prepared to add them later ([Silvermind digital minting service](https://www.silvermind.art) will help with th).

For privacy purposes and cleanness, we **clear all the metadata** from the image and add what's provided in the `.toml` file(s). However, one can also take a different approach, and actually write/clear only specific tags.

### Certificate of authenticity
A certificate of authenticity is a pdf digitally signed by the author (and by some other authorities if needed).

Signing a PDF out of scope of this project, as we only do the NFT part. 

However, you can conveniently prepare a PDF by using the `certificate` (i.e. `XMP-xmpRights:certificate`) tag.

For example:
```toml
["artwork.png"]
certificate='certificate.pdf'

# ... and somewhere else
["artwork/certificate.pdf"]
# ... info needed for the PDF generation
```

For more examples, please refer to the [example project](./nft-workspace/example-project). Here's the list of fields that are supported:

- author
- title
- TODO: add all

If you already have a certificate PDF and simply want to use it, you can do it like this:
```toml
["artwork.png"]
# Get out of the scope of the current artwork
certificate='/folder/where/certificate/is/artwork-certificate.pdf'

# ... and somewhere else
["artwork/certificate.pdf"]
# or
# ["artwork/artwork-certificate.pdf"]
```

You can also specify metadata fields for the certificate that you already have, but be aware that if the certificate is digitally signed already, it will not be touched, as the signature will be broken.

These two examples are equivalent:
```toml
["artwork.png"]
# Get out of the scope of the current artwork
certificate='/folder/where/certificate/is/artwork-certificate.pdf'

# ... and somewhere else
["artwork/certificate.pdf"]
author='John Doe'
```

```toml
["artwork.png"]
# This must be on a single line!!! Maybe better use the first variant? 
certificate={'/folder/where/certificate/is/artwork-certificate.pdf' = {author='John Doe'}}
```

### Digital artefact creation

After we have an artwork and metadata (`.toml` files) ready, we need to prepare for the minting:

- Enrich the original image with metadata
- Create a preview image
- Generate (or copy over) the certificate of authenticity
- Copy over the license file
- Generate the informational page
- Create the digital artefact zip file
- Create the nft.json file

Everything will be uploaded to IPFS, the contents will look like this:

| Unencrypted Digital Artefact (UDA) | Encrypted Digital Artefact (EDA) |
|------------------------------------|----------------------------------|
| artwork.XYZ                        |                                  |
| preview.XYZ                        | preview.XYZ                      |
| certificate.pdf                    | certificate.pdf                  |
| license.txt                        | license.txt                      |
| nft.json                           | nft.json                         |
| info.html                          | info.html                        |
| UDA.zip                            | EDA.png                          |

#### Contents of UDA.zip
All the files that are outside zip are also inside zip, except for `nft.json`.

#### About EDA.png
EDA is an image with binary data written to an ancillary chunk. In fact that binary data is an encrypted UDA.zip. The image is a preview image. Read more about [EDA here](https://docs.silvermind.art/fundamentals/encrypted-digital-artefact-eda).

Creator can safely use EDA.png as the content of an NFT and publish it to everyone, because only the owner can extract and decrypt the zip (a separate dApp is necessary for that, e.g. [Silvermind](https://www.silvermind.art)). Hackers are left with the preview image only, as they won't be able to decrypt the zip.

# Credits

Example photos we use [picsum.photos](https://picsum.photos) which are taken from [Unsplash](https://unsplash.com) and licensed as [public domain](https://unsplash.com/license).

- landscape [download](https://picsum.photos/id/867/4288/2848) [info](https://picsum.photos/id/867/info)
- portrait [download](https://picsum.photos/id/997/2528/3735) [info](https://picsum.photos/id/997/info)
- square [download](https://picsum.photos/id/670/1367) [info](https://picsum.photos/id/670/info)


# More on the topic

- [Silvermind docs](https://docs.silvermind.art)
- Research
  - [Semantics and Non-Fungible Tokens for Copyright Management on the Metaverse and beyond](https://arxiv.org/pdf/2208.14174.pdf)
  - [Darkblock](https://www.darkblock.io/)
