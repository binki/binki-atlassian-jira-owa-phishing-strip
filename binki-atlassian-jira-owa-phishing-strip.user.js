// ==UserScript==
// @name binki-atlassian-jira-owa-phishing-strip
// @version 1.2.2
// @match https://*.atlassian.net/*
// @homepageURL https://github.com/binki/binki-atlassian-jira-owa-phishing-strip
// @require https://github.com/binki/binki-userscript-delay-async/raw/252c301cdbd21eb41fa0227c49cd53dc5a6d1e58/binki-userscript-delay-async.js
// @require https://github.com/binki/binki-userscript-when-element-changed-async/raw/88cf57674ab8fcaa0e86bdf5209342ec7780739a/binki-userscript-when-element-changed-async.js
// @require https://github.com/binki/binki-userscript-when-element-query-selector-async/raw/0a9c204bdc304a9e82f1c31d090fdfdf7b554930/binki-userscript-when-element-query-selector-async.js
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
          break;
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
            break;
          } catch (ex) {
            if (lastTry) throw ex;
          }
        }
      }
    }
    if (changeMade) {
      location.reload();
    }
    await Promise.all([delayAsync(60000), whenElementChangedAsync(await whenElementQuerySelectorAsync(document, '[data-testid="issue.activity.comments-list"]'))]);
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
    
	  // There are different document variants. Table version:
    if (await editTableAtlassianDocumentAsync(document)) return true;

    // Text version
    if (await editTextAtlassianDocumentAsync(document)) return true;
    
    return false;
  } catch (ex) {
    console.log('error editing document', document, ex);
    throw ex;
  }
}

async function editTableAtlassianDocumentAsync(document) {
  const table = document.content[0];
  if (table.type !== 'table') return false;
  if (table.content.length !== 1) return false;
  const tableRow = table.content[0];
  if (tableRow.type !== 'tableRow') return false;
  for (const tableCell of tableRow.content) {
    if (tableCell.type !== 'tableCell') continue;
    const textContent = atlassianDocumentTextContent(tableCell);
    if (/^\s*You don't often get email from [^\s]+\.\s+Learn why this is important\s*$/v.test(textContent)) {
      document.content.splice(0, 1);
      removeEmptyPrologue(document);
      console.log(textContent, document);
      return true;
    }
  }
  return false;
}

async function editTextAtlassianDocumentAsync(document) {
  // Format is like: {"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":" ||"},{"type":"text","text":"You don't often get email from noreply@example.com. ","marks":[{"type":"textColor","attrs":{"color":"#000000"}}]},{"type":"text","text":"Learn why this is important","marks":[{"type":"textColor","attrs":{"color":"#000000"}},{"type":"link","attrs":{"href":"https://aka.ms/LearnAboutSenderIdentification"}}]},{"type":"text","text":" ||"},{"type":"hardBreak"},{"type":"text","text":" "},{"type":"hardBreak"},{"type":"text","text":" "}]}]}
  const paragraph = document.content[0];
  if (paragraph.type !== 'paragraph') return false;
  const normalizedText = atlassianDocumentTextContent(paragraph).replace(/\s+/gv, ' ');
  if (/^ ?\|\| ?You don\S*t often get email from \S+ ?\. Learn why this is important ?\|\| ?$/v.test(normalizedText)) {
    // Remove the paragraph
    document.content.splice(0, 1);
    removeEmptyPrologue(document);
    return true;
  }
  return false;
}

function removeEmptyPrologue(document) {
  // A very specific test for extra empty paragraphs and tables that might be left over at the beginning. Don’t
  // simply test the text content of it because it might be something important but empty like an image
  // without alt text or a card.
  while (true) {
    if (!document.content.length) break;
    const first = document.content[0];
    if (first.type === 'paragraph') {
		  if (first.content.length > 1) break;
      const text = first.content[0];
      // Allow empty instead of requiring text.
      if (text) {
      	if (text.type !== 'text') break;
      }
    } else if (first.type === 'table') {
      if (first.content.length > 1) break;
      const row = first.content[0];
      if (row) {
        if (row.type !== 'tableRow') break;
        if (row.content.length > 1) break;
        const cell = row.content[0];
        if (cell) {
          if (cell.type !== 'tableCell') break;
          // Now that we have a cell, verify that it has something like a paragraph or text in it.
          if (cell.content.length > 1) break;
          const cellFirst = cell.content[0];
          if (cellFirst) {
            if (cellFirst.type !== 'paragraph') break;
          }
        }
      }
    } else {
      break;
    }
    if (!/^\s*$/v.test(atlassianDocumentTextContent(first))) break;
    document.content.splice(0, 1);
  }
}

function atlassianDocumentTextContent(document) {
  try {
    switch (document.type) {
      case 'paragraph':
        // content is optional in a paragraph.
        if (document.content) return document.content.map(content => atlassianDocumentTextContent(content)).join('');
        return '\n';
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
