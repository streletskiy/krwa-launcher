const { compile } = require('html-to-text')

const MAX_RELEASE_NOTES_INPUT = 100_000
const MAX_RELEASE_NOTES_OUTPUT = 20_000

const convertReleaseNotesHtml = compile({
    wordwrap: false,
    limits: {
        maxInputLength: MAX_RELEASE_NOTES_INPUT,
        maxDepth: 30,
        maxChildNodes: 2_000,
        maxBaseElements: 1
    },
    selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'h1', options: { uppercase: false } },
        { selector: 'h2', options: { uppercase: false } },
        { selector: 'h3', options: { uppercase: false } },
        { selector: 'h4', options: { uppercase: false } },
        { selector: 'h5', options: { uppercase: false } },
        { selector: 'h6', options: { uppercase: false } },
        { selector: 'img', format: 'skip' },
        { selector: 'svg', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'iframe', format: 'skip' },
        { selector: 'object', format: 'skip' }
    ]
})

function normalizeReleaseNotesInput(value){
    if(Array.isArray(value)){
        return value
            .map(item => typeof item === 'string' ? item : item?.note)
            .filter(item => typeof item === 'string' && item.length > 0)
            .join('\n\n')
    }
    if(value != null && typeof value === 'object' && typeof value.note === 'string'){
        return value.note
    }
    return typeof value === 'string' ? value : ''
}

function releaseNotesToPlainText(value){
    const input = normalizeReleaseNotesInput(value).slice(0, MAX_RELEASE_NOTES_INPUT)
    if(input.length === 0){
        return ''
    }
    return convertReleaseNotesHtml(input)
        .replaceAll('\u00a0', ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_RELEASE_NOTES_OUTPUT)
}

module.exports = { releaseNotesToPlainText }
