// ==UserScript==
// @name binki-atlassian-jira-owa-phishing-strip
// @version 1.0.0
// @match https://*.atlassian.net/*
// @homepageURL https://github.com/binki/binki-atlassian-jira-owa-phishing-strip
// @require https://github.com/binki/binki-userscript-delay-async/raw/252c301cdbd21eb41fa0227c49cd53dc5a6d1e58/binki-userscript-delay-async.js
// @require https://github.com/binki/binki-userscript-when-element-changed-async/raw/88cf57674ab8fcaa0e86bdf5209342ec7780739a/binki-userscript-when-element-changed-async.js
// ==/UserScript==

(async () => {
  const key = /[^?]*\/([A-Z]+-[0-9]+)(?:$|\?)/.exec(document.documentURI)[1];
  if (!key) return;
  while (true) {
    const issue = await (await assertFetch(new URL(`/rest/api/3/issue/${encodeURIComponent(key)}`, document.documentURI))).json();
    let changeMade = false;
    if (await editAtlassianDocumentAsync(issue.fields.description)) {
      for (const [requestNoNotify, lastTry] of [
        [true, false], 
        [false, true],
      ]) {
        try {
          await assertFetch(new URL(`/rest/api/3/issue/${encodeURIComponent(key)}?${requestNoNotify ? 'notifyUsers=false&' : ''}`, document.documentURI), {
            body: JSON.stringify({
              update: {
                description: [
                  {
                    set: issue.fields.description,
                  },
                ],
              },
            }),
            headers: {
              'Content-Type': 'application/json',
            },
            method: 'PUT',
          });
          changeMade = true;
        } catch (ex) {
          if (lastTry) throw ex;
        }
      }
    }
    for (const comment of issue.fields.comment.comments) {
      if (await editAtlassianDocumentAsync(comment.body)) {
        for (const [requestNoNotify, lastTry] of [
          [true, false],
          [false, true],
        ]) {
          try {
            await assertFetch(`${comment.self}?${requestNoNotify ? 'notifyUsers=false&' : ''}`, {
              body: JSON.stringify({
                body: comment.body,
              }),
              headers: {
                'Content-Type': 'application/json',
              },
              method: 'PUT',
            });
            changeMade = true;
          } catch (ex) {
            if (lastTry) throw ex;
          }
        }
      }
    }
    if (changeMade) {
      location.reload();
    }
    await Promise.all([delayAsync(60000), whenElementChangedAsync(document.querySelector('[data-testid="issue.activity.comments-list"]'))]);
  }
})();

async function assertFetch(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    console.log(response);
    throw new Error(`Request to ${url} not OK: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function editAtlassianDocumentAsync(document) {
  try {
  	if (document.type !== 'doc') throw new Error(`Top-level document element must be “doc”. Got “${document.type}”`);
    if (!document.content.length) return false;
    const table = document.content[0];
    // This might be incapable of handling the plaintext version?
    if (table.type !== 'table') return false;
    if (table.content.length !== 1) return false;
    const tableRow = table.content[0];
    if (tableRow.type !== 'tableRow') return false;
    for (const tableCell of tableRow.content) {
      if (tableCell.type !== 'tableCell') continue;
      const textContent = atlassianDocumentTextContent(tableCell);
      if (/^\s*You don't often get email from [^\s]+\.\s+Learn why this is important\s*$/v.test(textContent)) {
        document.content.splice(0, 1);
        // A very specific test for extra empty paragraphs that might be left over at the beginning. Don’t
        // simply test the text content of it because it might be something important but empty like an image
        // without alt text or a card.
        while (document.content.length && document.content[0].type === 'paragraph' && document.content[0].content.length === 1 && document.content[0].content[0].type === 'text' && /^\s*$/v.test(atlassianDocumentTextContent(document.content[0]))) {
					document.content.splice(0, 1);
        }
        console.log(textContent, document);
        return true;
      }
    }
    return false;
  } catch (ex) {
    console.log('error editing document', document, ex);
    throw ex;
  }
}

function atlassianDocumentTextContent(document) {
  try {
    switch (document.type) {
      case 'blockquote':
      case 'bulletList':
      case 'codeBlock':
      case 'heading':
      case 'listItem':
      case 'mediaSingle':
      case 'orderedList':
      case 'panel':
      case 'doc':
      case 'expand':
      case 'paragraph':
      case 'table':
      case 'tableRow':
      case 'tableCell':
      case 'tableHeader':
        return document.content.map(content => atlassianDocumentTextContent(content)).join('');
      case 'inlineCard':
        // Maybe a card is supposed to have text content? Especially if it has JSONLD in it?
        return '';
      case 'emoji':
        return document.attrs.text;
      case 'hardBreak':
        return '\n';
      case 'media':
      case 'mediaGroup':
      case 'mention':
        break;
      case 'rule':
        return '\n\n\n';
      case 'text':
        return document.text;
      default:
        throw new Error(`Unrecognized node type: ${document.type}`);
    }
  } catch (ex) {
    console.log('error extracting text content document fragment', document, ex);
    throw ex;
  }
}
