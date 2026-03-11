// Biscotti - Cookie Manager
// Delete cookies from the current page

let currentTab = null;
let currentDomain = null;

const siteEl = document.getElementById("currentSite");
const countEl = document.getElementById("cookieCount");
const deleteBtn = document.getElementById("deleteBtn");
const statusMsg = document.getElementById("statusMsg");
const statusIcon = document.getElementById("statusIcon");
const statusText = document.getElementById("statusText");

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUrlDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

function showStatus(type, icon, text) {
    statusMsg.className = `status ${type}`;
    statusIcon.textContent = icon;
    statusText.textContent = text;
}

function hideStatus() {
    statusMsg.className = "status";
}

function setLoading(loading) {
    deleteBtn.classList.toggle("loading", loading);
    deleteBtn.disabled = loading;
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

/**
 * Returns all cookies for the given URL using chrome.cookies.getAll.
 * We query both with and without a leading dot to catch all variants.
 */
async function getCookiesForUrl(url) {
    const hostname = getUrlDomain(url);
    if (!hostname) return [];

    // Build an array of domain variants to query
    const domainVariants = [
        { url }, // by URL (catches session cookies)
        { domain: hostname }, // exact hostname
        { domain: `.${hostname}` }, // leading dot (subdomain cookies)
    ];

    const parts = hostname.split(".");
    if (parts.length > 2) {
        // e.g. for sub.example.com also query example.com
        const rootDomain = parts.slice(-2).join(".");
        domainVariants.push({ domain: rootDomain });
        domainVariants.push({ domain: `.${rootDomain}` });
    }

    const sets = await Promise.all(domainVariants.map((q) => chrome.cookies.getAll(q).catch(() => [])));

    // Deduplicate by (name + domain + path + storeId)
    const seen = new Set();
    const unique = [];
    for (const cookies of sets) {
        for (const c of cookies) {
            const key = `${c.name}||${c.domain}||${c.path}||${c.storeId}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(c);
            }
        }
    }
    return unique;
}

/**
 * Delete a single cookie. Tries both http and https schemes to cover all cases.
 */
async function deleteCookie(cookie) {
    const schemes = cookie.secure ? ["https"] : ["http", "https"];
    const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;

    for (const scheme of schemes) {
        const cookieUrl = `${scheme}://${domain}${cookie.path || "/"}`;
        try {
            await chrome.cookies.remove({ url: cookieUrl, name: cookie.name, storeId: cookie.storeId });
        } catch {
            // Silently ignore individual failures; we'll verify the count after
        }
    }
}

// ── Main logic ────────────────────────────────────────────────────────────────

async function init() {
    try {
        const { version } = chrome.runtime.getManifest();
        document.querySelector(".footer-version").textContent = `v${version}`;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tab;

        if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
            siteEl.textContent = "Page not supported";
            countEl.textContent = "0";
            deleteBtn.disabled = true;
            showStatus("info", "ℹ️", "Biscotti doesn't work on Chrome pages.");
            return;
        }

        currentDomain = getUrlDomain(tab.url);
        siteEl.textContent = currentDomain || tab.url;

        await refreshCount();
    } catch (err) {
        console.error("[Biscotti] init error:", err);
        showStatus("error", "❌", "Error while loading.");
    }
}

async function refreshCount() {
    if (!currentTab) return;
    const cookies = await getCookiesForUrl(currentTab.url);
    countEl.textContent = cookies.length;
    deleteBtn.disabled = cookies.length === 0;
    if (cookies.length === 0) {
        deleteBtn.disabled = true;
    }
}

deleteBtn.addEventListener("click", async () => {
    if (!currentTab) return;
    hideStatus();
    setLoading(true);

    try {
        const cookies = await getCookiesForUrl(currentTab.url);

        if (cookies.length === 0) {
            showStatus("info", "ℹ️", "No cookie to delete.");
            setLoading(false);
            return;
        }

        // Delete all cookies in parallel
        await Promise.all(cookies.map(deleteCookie));

        // Verify
        const remaining = await getCookiesForUrl(currentTab.url);
        const deleted = cookies.length - remaining.length;

        countEl.textContent = remaining.length;

        if (remaining.length === 0) {
            showStatus("success", "✅", `${deleted} cookies succesfully deleted!`);
        } else {
            showStatus("info", "⚠️", `${deleted} deleted, ${remaining.length} not deletable.`);
        }

        deleteBtn.disabled = remaining.length === 0;
    } catch (err) {
        console.error("[Biscotti] delete error:", err);
        showStatus("error", "❌", "Error while deleting.");
    } finally {
        setLoading(false);
    }
});

// Kick off
init();
