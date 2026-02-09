const COMMENT_API_PATTERN = '*://api.bilibili.com/x/v2/reply*';
const RESPONSE_DEDUPE_MS = 1500;

const seenReplyIds = new Set();
const recentFetches = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    return;
  }
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.statusCode !== 200 || !details.url) {
      return;
    }

    const lastFetch = recentFetches.get(details.url) ?? 0;
    const now = Date.now();
    if (now - lastFetch < RESPONSE_DEDUPE_MS) {
      return;
    }
    recentFetches.set(details.url, now);

    try {
      const response = await fetch(details.url, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json, text/plain, */*'
        }
      });

      if (!response.ok) {
        return;
      }

      const json = await response.json();
      const replies = extractReplies(json);
      const freshReplies = replies.filter((reply) => {
        if (!reply?.rpid) {
          return false;
        }
        if (seenReplyIds.has(reply.rpid)) {
          return false;
        }
        seenReplyIds.add(reply.rpid);
        return true;
      });

      if (freshReplies.length === 0) {
        return;
      }

      chrome.runtime.sendMessage({
        type: 'bili-replies',
        payload: {
          replies: freshReplies,
          page: json?.data?.page ?? null,
          sourceUrl: details.url
        }
      });
    } catch (error) {
      console.warn('Failed to fetch Bilibili replies', error);
    }
  },
  { urls: [COMMENT_API_PATTERN] }
);

function extractReplies(json) {
  const data = json?.data ?? {};
  const replies = Array.isArray(data.replies) ? data.replies : [];
  const topReplies = Array.isArray(data.top?.replies) ? data.top.replies : [];
  return [...topReplies, ...replies];
}
