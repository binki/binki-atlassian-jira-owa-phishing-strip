// ==UserScript==
// @name binki-atlassian-jira-unmangle-edit
// @version 2.2.1
// @match https://*.atlassian.net/*
// @homepageURL https://github.com/binki/binki-atlassian-jira-unmangle-edit
// @require https://github.com/binki/binki-userscript-delay-async/raw/252c301cdbd21eb41fa0227c49cd53dc5a6d1e58/binki-userscript-delay-async.js
// @require https://github.com/binki/binki-userscript-url-unfence/raw/429fec010fa0635ef3b6ae754aabcb542a39bc54/binki-userscript-url-unfence.js
// @require https://github.com/binki/binki-userscript-when-element-changed-async/raw/88cf57674ab8fcaa0e86bdf5209342ec7780739a/binki-userscript-when-element-changed-async.js
// ==/UserScript==

(async () => {
  const key = /[^?]*\/([A-Z]+-[0-9]+)(?:$|\?)/.exec(document.documentURI)[1];
  if (!key) return;
  while (true) {
    const issue = await (await assertFetch(new URL(`/rest/api/3/issue/${encodeURIComponent(key)}`, document.documentURI))).json();
    let changeMade = false;
    if (await unmangleAtlassianDocumentAsync(issue.fields.description)) {
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
      if (await unmangleAtlassianDocumentAsync(comment.body)) {
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

async function unmangleAtlassianDocumentAsync(document) {
  let modified = false;
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
        for (const contentItem of document.content) {
          if (await unmangleAtlassianDocumentAsync(contentItem)) {
            modified = true;
          }
        }
        break;
      case 'inlineCard':
        if (document.attrs && document.attrs.url) {
          const newUrl = await binkiUserscriptUrlUnfenceAsync(document.attrs.url);
          if (newUrl !== document.attrs.url) {
            console.log(`Replacing inlineCard URL ${document.attrs.url} with ${newUrl}`);
            document.attrs.url = newUrl;
            modified = true;
          }
        }
        break;
      case 'emoji':
      case 'hardBreak':
      case 'media':
      case 'mediaGroup':
      case 'mention':
      case 'rule':
        break;
      case 'text':
        for (const mark of document.marks || []) {
          switch (mark.type) {
            case 'border':
            case 'code':
            case 'em':
            case 'strike':
            case 'strong':
            case 'subsup':
            case 'textColor':
            case 'underline':
              break;
            case 'link':
              if (mark.attrs.href) {
                const newHref = await binkiUserscriptUrlUnfenceAsync(mark.attrs.href);
                if (newHref !== mark.attrs.href) {
                  modified = true;
                  console.log(`Replacing link “${mark.attrs.href}” with “${newHref}”.`);
                  mark.attrs.href = newHref;
                }
              }
              break;
            default:
              throw new Error(`Unrecognized mark type: ${mark.type}`);
          }
        }
        const newText = await replaceAsync(document.text, /(https?:\/\/.*?)(?:$| |[^\w%\/=](?:$|\s))/gv, async (match, p1) => {
          return await binkiUserscriptUrlUnfenceAsync(p1);
        });
        if (newText !== document.text) {
          console.log(`Replacing text with links “${document.text}” with “${newText}”`);
          modified = true;
          document.text = newText;
        }
        break;
      default:
        throw new Error(`Unrecognized node type: ${document.type}`);
    }
  } catch (ex) {
    console.log('error editing document', document, ex);
    throw ex;
  }
  return modified;
}

async function replaceAsync(s, regExp, buildReplacementAsync) {
  const match = regExp.exec(s);
  if (!match) return s;
  return await buildReplacementAsync.apply(this, match.concat(match.index, s, match.groups)) + await replaceAsync(s.substring(match.index + match[0].length), regExp, buildReplacementAsync);
}
