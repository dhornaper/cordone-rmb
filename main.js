const INDEX_URL = "data/archive/index.json";
const NATIONSTATES_ORIGIN = "https://www.nationstates.net";
const ARCHIVE_ICON_URL = "https://www.nationstates.net/images/externallink.gif";

const messagesContainer = document.querySelector("#messages");
const archive = document.querySelector("#archive");
const status = document.querySelector("#archive-status");
const summary = document.querySelector("#archive-summary");
const searchForm = document.querySelector("#archive-search");
const searchTermsInput = document.querySelector("#search-terms");
const searchAuthorInput = document.querySelector("#search-author");
const searchSortSelect = document.querySelector("#search-sort");
const pagers = [
	document.querySelector("#pagination-top"),
	document.querySelector("#pagination-bottom"),
];

function escapeHTML(value) {
	return String(value ?? "").replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	}[character]));
}

function formatMessage(value) {
	const source = String(value ?? "").replace(/\r\n?/g, "\n");
	const fragment = document.createDocumentFragment();
	const stack = [{ name: "root", node: fragment }];
	const tokenPattern = /\[([^\]]*)\]/g;
	let cursor = 0;

	function currentNode() {
		return stack[stack.length - 1].node;
	}

	function appendText(node, text, preserveWhitespace = false, autoLink = true) {
		if (!text) return;
		const urlPattern = /https?:\/\/[^\s<>"']+/gi;
		let textCursor = 0;
		let match;

		function appendPlain(value) {
			if (preserveWhitespace) {
				node.append(document.createTextNode(decodeEntities(value)));
				return;
			}
			const lines = value.split("\n");
			lines.forEach((line, index) => {
				if (line) node.append(document.createTextNode(decodeEntities(line)));
				if (index < lines.length - 1) node.append(document.createElement("br"));
			});
		}

		if (!autoLink || preserveWhitespace) {
			appendPlain(text);
			return;
		}

		while ((match = urlPattern.exec(text)) !== null) {
			let url = match[0];
			let trailing = "";
			while (/[.,!?;:)\]]$/.test(url)) {
				trailing = url.slice(-1) + trailing;
				url = url.slice(0, -1);
			}
			appendPlain(text.slice(textCursor, match.index));
			const href = nationStatesTarget(url);
			if (href) node.append(createAnchor(href, url));
			else appendPlain(url);
			appendPlain(trailing);
			textCursor = match.index + match[0].length;
		}
		appendPlain(text.slice(textCursor));
	}

	function closeTag(name, literal) {
		let index = stack.length - 1;
		while (index > 0 && stack[index].name !== name) index -= 1;
		if (index === 0) {
			appendText(currentNode(), literal);
			return;
		}
		while (stack.length > index) {
			const frame = stack.pop();
			frame.finish?.();
		}
	}

	function pushTag(name, node, finish) {
		currentNode().append(node);
		stack.push({ name, node, finish });
	}

	function setStyle(node, property, value) {
		node.style[property] = value;
		return Boolean(node.style[property]);
	}

	function openTag(name, argument, literal) {
		const parent = currentNode();
		const inlineTags = { b: "strong", i: "em", u: "u", s: "s", strike: "del", sub: "sub", sup: "sup", small: "small" };
		if (inlineTags[name]) {
			pushTag(name, document.createElement(inlineTags[name]));
			return true;
		}
		if (name === "br" || name === "hr") {
			parent.append(document.createElement(name));
			return true;
		}
		if (name === "nation" || name === "region") {
			const link = document.createElement("a");
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			pushTag(name, link, () => {
				const href = entityHref(name, link.textContent);
				if (href) link.href = href;
				else link.replaceWith(document.createTextNode(link.textContent));
			});
			return true;
		}
		if (name === "url") {
			const link = document.createElement("a");
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			if (argument !== undefined) {
				const href = nationStatesTarget(argument);
				if (href) link.href = href;
			}
			pushTag(name, link, () => {
				if (!link.hasAttribute("href")) {
					const href = nationStatesTarget(link.textContent.trim());
					if (href) link.href = href;
				}
				if (!link.hasAttribute("href")) link.replaceWith(document.createTextNode(link.textContent));
			});
			return true;
		}
		if (name === "proposal") {
			const link = createAnchor(nationStatesTarget(`page=UN_view_proposal/id=${argument || ""}`), "");
			pushTag(name, link);
			return true;
		}
		if (name === "resolution") {
			const link = createAnchor(nationStatesTarget("page=UN_past_resolutions/start=1"), "");
			if (argument) link.title = `World Assembly resolution ${argument}`;
			pushTag(name, link);
			return true;
		}
		if (name === "spoiler") {
			const details = document.createElement("details");
			const summaryNode = document.createElement("summary");
			summaryNode.textContent = argument || "Spoiler";
			const body = document.createElement("div");
			details.append(summaryNode, body);
			parent.append(details);
			stack.push({ name, node: body });
			return true;
		}
		if (name === "quote" || name === "wrote") {
			const quote = document.createElement("blockquote");
			if (argument) {
				const [author, postId] = argument.split(";");
				const cite = document.createElement("cite");
				const authorHref = entityHref("nation", author);
				if (authorHref) cite.append(createAnchor(authorHref, displayNation(author)));
				else cite.append(document.createTextNode(author));
				cite.append(document.createTextNode(" wrote:"));
				quote.append(cite);
				const archiveHref = postId && archiveMessageHref(postId);
				if (archiveHref) {
					const postLink = createAnchor(archiveHref, "");
					postLink.className = "archive-quote-link";
					postLink.target = "_self";
					postLink.setAttribute("aria-label", `Open quoted post ${postId} in this archive`);
					const icon = document.createElement("img");
					icon.src = ARCHIVE_ICON_URL;
					icon.alt = "";
					icon.width = 12;
					icon.height = 12;
					postLink.append(icon);
					quote.append(postLink);
				}
			}
			pushTag(name, quote);
			return true;
		}
		if (name === "pre") {
			const pre = document.createElement("pre");
			pre.className = "archive-bbcode-pre";
			pushTag(name, pre);
			return true;
		}
		if (name === "list") {
			const list = document.createElement(argument ? "ol" : "ul");
			if (argument && /^[1aAiI]$/.test(argument.trim())) list.type = argument.trim();
			pushTag(name, list);
			return true;
		}
		if (name === "*") {
			const listIndex = stack.findLastIndex((frame) => frame.name === "list");
			if (listIndex < 0) return false;
			for (let index = stack.length - 1; index > listIndex; index -= 1) {
				if (stack[index].name === "li") {
					while (stack.length > index) stack.pop().finish?.();
					break;
				}
			}
			const item = document.createElement("li");
			currentNode().append(item);
			stack.push({ name: "li", node: item });
			return true;
		}
		if (name === "table") {
			const table = document.createElement("table");
			table.className = "archive-bbcode-table";
			const body = document.createElement("tbody");
			table.append(body);
			parent.append(table);
			stack.push({ name, node: body });
			return true;
		}
		if (name === "tr" || name === "td") {
			const node = document.createElement(name);
			pushTag(name, node);
			return true;
		}
		if (name === "img") {
			const image = document.createElement("img");
			image.className = "archive-bbcode-image";
			image.alt = "";
			image.loading = "lazy";
			if (argument) {
				const src = nationStatesTarget(argument);
				if (src) image.src = src;
				parent.append(image);
			} else {
				const placeholder = document.createElement("span");
				pushTag(name, placeholder, () => {
					const src = nationStatesTarget(placeholder.textContent.trim());
					if (src) {
						image.src = src;
						placeholder.replaceWith(image);
					} else {
						placeholder.replaceWith(document.createTextNode(placeholder.textContent));
					}
				});
			}
			return true;
		}
		if (name === "color" || name === "colour" || name === "background" || name === "background-block") {
			const block = name === "background-block";
			const node = document.createElement(block ? "div" : "span");
			node.className = block ? "archive-bbcode-background-block" : "archive-bbcode-style";
			const property = name === "color" || name === "colour" ? "color" : "backgroundColor";
			if (!argument || !setStyle(node, property, argument)) return false;
			pushTag(name, node);
			return true;
		}
		if (name === "font" || name === "size") {
			const node = document.createElement("span");
			node.className = "archive-bbcode-style";
			if (name === "font") {
				if (!argument || !setStyle(node, "fontFamily", argument)) return false;
			} else {
				const size = Number.parseInt(argument, 10);
				if (!Number.isFinite(size) || size < 50 || size > 300) return false;
				node.style.fontSize = `${size}%`;
			}
			pushTag(name, node);
			return true;
		}
		if (name === "align" || name === "center" || name === "centre") {
			const alignment = name === "align" ? argument?.toLowerCase() : "center";
			if (!alignment || !["left", "right", "center", "justify"].includes(alignment)) return false;
			const node = document.createElement("div");
			node.className = "archive-bbcode-align";
			node.style.textAlign = alignment;
			pushTag(name, node);
			return true;
		}
		if (name === "float") {
			if (!["left", "right"].includes(argument?.toLowerCase())) return false;
			const node = document.createElement("div");
			node.className = "archive-bbcode-float";
			node.style.float = argument.toLowerCase();
			pushTag(name, node);
			return true;
		}
		if (name === "box") {
			const node = document.createElement("div");
			node.className = "archive-bbcode-box";
			pushTag(name, node);
			return true;
		}
		if (name === "tab") {
			const indent = Math.max(0, Math.min(400, Number.parseInt(argument, 10) || 0));
			const node = document.createElement("div");
			node.className = "archive-bbcode-tab";
			node.style.marginLeft = `${indent}px`;
			pushTag(name, node);
			return true;
		}
		if (name === "anchor") {
			const anchor = document.createElement("span");
			anchor.id = `bbcode-${String(argument || "").replace(/[^a-z0-9_-]/gi, "-")}`;
			pushTag(name, anchor);
			return true;
		}
		return false;
	}

	let match;
	while ((match = tokenPattern.exec(source)) !== null) {
		const preformatted = stack.some((frame) => frame.name === "pre");
		const insideLink = stack.some((frame) => frame.name === "url" || frame.name === "nation" || frame.name === "region");
		appendText(currentNode(), source.slice(cursor, match.index), preformatted, !insideLink);
		const token = match[1];
		if (preformatted && !/^\s*\/pre\s*$/i.test(token)) {
			appendText(currentNode(), match[0], true, false);
		} else {
			const parsed = token.match(/^\s*(\/)?([a-z*_-]+)(?:\s*=\s*([\s\S]*?))?\s*$/i);
			if (!parsed) appendText(currentNode(), match[0]);
			else {
				const closing = Boolean(parsed[1]);
				const name = parsed[2].toLowerCase();
				const argument = parsed[3];
				if (closing) closeTag(name, match[0]);
				else if (!openTag(name, argument, match[0])) appendText(currentNode(), match[0]);
			}
		}
		cursor = match.index + match[0].length;
	}
	const preformatted = stack.some((frame) => frame.name === "pre");
	const insideLink = stack.some((frame) => frame.name === "url" || frame.name === "nation" || frame.name === "region");
	appendText(currentNode(), source.slice(cursor), preformatted, !insideLink);
	while (stack.length > 1) stack.pop().finish?.();
	return fragment;
}

function formatDate(timestamp) {
	const date = new Date(Number(timestamp) * 1000);
	if (Number.isNaN(date.getTime())) return "Date unavailable";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function displayNation(nation) {
	return String(nation || "Unknown nation")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function createAnchor(href, label) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.target = "_blank";
	anchor.rel = "noopener noreferrer";
	anchor.textContent = label;
	return anchor;
}

function decodeEntities(value) {
	const textarea = document.createElement("textarea");
	textarea.innerHTML = String(value).replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return textarea.value;
}

function nationStatesTarget(target) {
	const value = decodeEntities(String(target || "")).trim();
	if (!value) return null;
	let url;
	try {
		if (/^https?:\/\//i.test(value)) url = new URL(value);
		else if (value.startsWith("//")) url = new URL(`https:${value}`);
		else {
			let path = value.startsWith("/") ? value : `/${value}`;
			const composeTarget = value.match(/^([^/?#]+)#composebutton$/i);
			if (composeTarget) {
				const nation = composeTarget[1].trim().toLowerCase().replace(/[\s_]+/g, "_");
				path = `/nation=${nation}#composebutton`;
			}
			url = new URL(path, NATIONSTATES_ORIGIN);
		}
	} catch {
		return null;
	}
	return ["http:", "https:"].includes(url.protocol) ? url.href : null;
}

function entityHref(type, label) {
	const slug = String(label || "").trim().toLowerCase().replace(/[\s_]+/g, "_");
	return slug ? nationStatesTarget(`${type}=${slug}`) : null;
}

function archiveMessageHref(postId) {
	const page = messagePages.get(String(postId));
	return page ? `main.html?page=${page}#message-${encodeURIComponent(postId)}` : null;
}

function entityLink(type, slug, label) {
	const href = entityHref(type, slug);
	return href
		? `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`
		: escapeHTML(label);
}

function highlightSearchTerms(root, terms) {
	const words = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
	if (!words.length) return;
	const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes = [];
	while (walker.nextNode()) textNodes.push(walker.currentNode);
	for (const textNode of textNodes) {
		pattern.lastIndex = 0;
		const text = textNode.nodeValue || "";
		let cursor = 0;
		let match;
		const fragment = document.createDocumentFragment();
		while ((match = pattern.exec(text)) !== null) {
			if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)));
			const mark = document.createElement("mark");
			mark.className = "archive-search-match";
			mark.textContent = match[0];
			fragment.append(mark);
			cursor = match.index + match[0].length;
		}
		if (cursor === 0) continue;
		if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
		textNode.replaceWith(fragment);
	}
}

function createMessage(post, index, searchTerms = []) {
	const metadata = [
		post.EMBASSY ? `Embassy: ${entityLink("region", post.EMBASSY, post.EMBASSY)}` : "",
		post.EDITED ? `Edited: ${escapeHTML(formatDate(post.EDITED))}` : "",
	].filter(Boolean).join(" · ");
	const likeCount = Number(post.LIKES) || 0;
	const likerSlugs = String(post.LIKERS || "")
		.split(":")
		.filter(Boolean);
	const shownNames = likerSlugs.slice(0, Math.min(3, likeCount));
	const remainingNames = likerSlugs.slice(shownNames.length);
	let likes = "";
	if (likeCount > 0) {
		let likeSummary = `${likeCount} likes`;
		if (shownNames.length) {
			likeSummary = `Liked by ${shownNames.map((slug) => entityLink("nation", slug, displayNation(slug))).join(", ")}`;
			if (likeCount > 3 && remainingNames.length) {
				const otherCount = Math.max(0, likeCount - shownNames.length);
				const otherLabel = `and by ${otherCount} ${otherCount === 1 ? "other" : "others"}`;
				const remainingLikers = remainingNames
					.map((slug) => entityLink("nation", slug, displayNation(slug)))
					.join(", ");
				likeSummary += ` <button class="archive-likers-toggle" type="button" aria-label="Show ${otherCount} more likers">${otherLabel}</button><span class="archive-likers-extra" aria-live="polite" tabindex="-1" hidden>, ${remainingLikers}</span>`;
			}
		}
		likes = `<footer class="archive-message-footer"><span class="archive-likes"><span class="archive-heart" aria-hidden="true">&#9829;</span> ${likeSummary}</span></footer>`;
	}
	const article = document.createElement("article");
	article.className = `rmbrow ${index % 2 === 0 ? "odd" : "even"} archive-message`;
	article.id = post["@id"] ? `message-${escapeHTML(post["@id"])}` : "";
	article.innerHTML = `
		<header class="rmbauthor2 archive-author">
			<strong>${entityLink("nation", post.NATION, displayNation(post.NATION))}</strong>
			<p class="rmbdate">${escapeHTML(formatDate(post.TIMESTAMP))}</p>
			<p class="archive-post-id">Post ${escapeHTML(post["@id"] || "")}</p>
			${metadata ? `<p class="archive-post-meta">${metadata}</p>` : ""}
		</header>
		<div class="rmbmsg2 archive-message-body">
			<div class="archive-message-content"></div>
			${likes}
		</div>`;
	const messageContent = article.querySelector(".archive-message-content");
	messageContent.append(formatMessage(post.MESSAGE));
	if (searchTerms.length) highlightSearchTerms(messageContent, searchTerms);
	return article;
}

messagesContainer.addEventListener("click", (event) => {
	const toggle = event.target.closest(".archive-likers-toggle");
	if (!toggle) return;
	const remainingLikers = toggle.nextElementSibling;
	if (toggle.previousSibling?.nodeType === Node.TEXT_NODE) {
		toggle.previousSibling.textContent = toggle.previousSibling.textContent.trimEnd();
	}
	remainingLikers.hidden = false;
	toggle.replaceWith(remainingLikers);
	remainingLikers.focus({ preventScroll: true });
});

function getCurrentPage(pageCount) {
	const pageParameter = new URLSearchParams(window.location.search).get("page");
	if (pageParameter === null) return pageCount;
	const requested = Number(pageParameter);
	if (!Number.isFinite(requested)) return pageCount;
	return Math.min(Math.max(1, Math.floor(requested)), pageCount);
}

function pageButtons(currentPage, pageCount) {
	const pages = new Set([1, pageCount]);
	for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
		if (page > 1 && page < pageCount) pages.add(page);
	}
	const ordered = [...pages].sort((a, b) => a - b);
	const controls = [];
	let previous = 0;

	for (const page of ordered) {
		if (page - previous > 1) {
			controls.push(`<button class="pagpage archive-ellipsis" type="button" data-page-jump data-page-count="${pageCount}" aria-label="Jump to a page">…</button>`);
		}
		controls.push(`<button class="pagpage ${page === currentPage ? "pagpage-current" : "pagpage-num"}" type="button" data-page="${page}"${page === currentPage ? ' aria-current="page"' : ""}>${page}</button>`);
		previous = page;
	}
	return controls.join("");
}

function render(posts, manifest, page) {
	messagesContainer.replaceChildren(...posts.map((post, index) => createMessage(post, index)));
	const pageLinks = [
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.max(1, page - 1)}" aria-label="Previous page"${page === 1 ? " disabled" : ""}>‹</button>`,
		pageButtons(page, manifest.total_pages),
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.min(manifest.total_pages, page + 1)}" aria-label="Next page"${page === manifest.total_pages ? " disabled" : ""}>›</button>`,
	];
	for (const pager of pagers) pager.innerHTML = pageLinks.join("");
	const firstMessage = (page - 1) * manifest.page_size + 1;
	const lastMessage = firstMessage + posts.length - 1;
	status.textContent = `Messages ${firstMessage.toLocaleString()}–${lastMessage.toLocaleString()} of ${manifest.total_messages.toLocaleString()} · Page ${page.toLocaleString()} of ${manifest.total_pages.toLocaleString()}`;
	status.className = "archive-count";
	archive.classList.remove("hide");
}

let manifest;
let pageController;
const messagePages = new Map();
let searchController;
let activeSearchResults = null;
let activeSearchOptions = null;
let activeSearchKey = "";
let activeSearchPage = 1;

function searchKey(options) {
	return JSON.stringify([options.terms, options.author, options.sort]);
}

function setSearchUrl(options, page, pushState) {
	const url = new URL(window.location.href);
	url.searchParams.delete("page");
	url.searchParams.set("search", "1");
	url.searchParams.set("q", options.terms.join(" "));
	url.searchParams.set("author", options.author);
	url.searchParams.set("sort", options.sort);
	if (page > 1) url.searchParams.set("result_page", String(page));
	else url.searchParams.delete("result_page");
	if (pushState) window.history.pushState({ mode: "search" }, "", url);
	else window.history.replaceState({ mode: "search" }, "", url);
}

function getSearchOptions() {
	return {
		terms: [...new Set(searchTermsInput.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))],
		author: searchAuthorInput.value.trim().toLocaleLowerCase().replaceAll("_", " "),
		sort: searchSortSelect.value,
	};
}

function countOccurrences(text, term) {
	let count = 0;
	let offset = 0;
	while ((offset = text.indexOf(term, offset)) !== -1) {
		count += 1;
		offset += term.length;
	}
	return count;
}

function sortSearchResults(results, sort) {
	const timestamp = (result) => Number(result.post.TIMESTAMP) || 0;
	if (sort === "newest") results.sort((a, b) => timestamp(b) - timestamp(a));
	else if (sort === "oldest") results.sort((a, b) => timestamp(a) - timestamp(b));
	else results.sort((a, b) => b.occurrences - a.occurrences || timestamp(b) - timestamp(a));
}

function renderSearchResults(page = 1) {
	const results = activeSearchResults || [];
	const pageCount = Math.max(1, Math.ceil(results.length / manifest.page_size));
	activeSearchPage = Math.min(Math.max(1, page), pageCount);
	const start = (activeSearchPage - 1) * manifest.page_size;
	const pageResults = results.slice(start, start + manifest.page_size);
	messagesContainer.replaceChildren(...pageResults.map((result, index) => createMessage(result.post, index, activeSearchOptions.terms)));
	const pagerContent = [
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.max(1, activeSearchPage - 1)}" aria-label="Previous results page"${activeSearchPage === 1 ? " disabled" : ""}>‹</button>`,
		pageButtons(activeSearchPage, pageCount),
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.min(pageCount, activeSearchPage + 1)}" aria-label="Next results page"${activeSearchPage === pageCount ? " disabled" : ""}>›</button>`,
	].join("");
	for (const pager of pagers) pager.innerHTML = pagerContent;
	if (results.length) {
		const first = start + 1;
		const last = start + pageResults.length;
		status.textContent = `${results.length.toLocaleString()} matches · Showing ${first.toLocaleString()}–${last.toLocaleString()} · Results page ${activeSearchPage} of ${pageCount}`;
	} else {
		status.textContent = "No messages matched this search.";
	}
	status.className = "archive-count";
	archive.classList.remove("hide");
}

async function searchArchive({ pushHistory = true, initialPage = 1 } = {}) {
	const options = getSearchOptions();
	if (!options.terms.length && !options.author) {
		status.textContent = "Enter at least one message word or an author.";
		status.className = "error";
		return;
	}
	searchController?.abort();
	const controller = new AbortController();
	searchController = controller;
	activeSearchResults = null;
	activeSearchOptions = options;
	activeSearchKey = searchKey(options);
	for (const pager of pagers) pager.replaceChildren();
	messagesContainer.replaceChildren();
	archive.classList.remove("hide");
	if (pushHistory) setSearchUrl(options, 1, true);
	status.textContent = `Searching all ${manifest.total_pages.toLocaleString()} archive pages…`;
	status.className = "archive-count";

	const matches = [];
	let nextPage = 0;
	let completedPages = 0;
	const worker = async () => {
		while (!controller.signal.aborted) {
			const pageIndex = nextPage;
			nextPage += 1;
			if (pageIndex >= manifest.pages.length) return;
			const pageInfo = manifest.pages[pageIndex];
			const response = await fetch(`data/archive/${pageInfo.file}`, {
				signal: controller.signal,
				cache: "no-store",
			});
			if (!response.ok) throw new Error(`Could not scan archive page ${pageInfo.number} (${response.status})`);
			const pageData = await response.json();
			for (const post of pageData.messages) {
				const author = String(post.NATION || "").replaceAll("_", " ").toLocaleLowerCase();
				if (options.author && !author.includes(options.author)) continue;
				const text = String(post.MESSAGE || "")
					.replace(/\[[^\]]*\]/g, " ")
					.toLocaleLowerCase();
				let occurrences = 0;
				let matchedAllTerms = true;
				for (const term of options.terms) {
					const termOccurrences = countOccurrences(text, term);
					if (!termOccurrences) {
						matchedAllTerms = false;
						break;
					}
					occurrences += termOccurrences;
				}
				if (matchedAllTerms) matches.push({ post, occurrences });
			}
			completedPages += 1;
			if (completedPages % 20 === 0 || completedPages === manifest.pages.length) {
				status.textContent = `Searching archive · ${completedPages.toLocaleString()} of ${manifest.pages.length.toLocaleString()} pages · ${matches.length.toLocaleString()} matches so far`;
			}
		}
	};

	try {
		const workerCount = Math.min(8, manifest.pages.length);
		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		if (controller.signal.aborted || searchController !== controller) return;
		sortSearchResults(matches, options.sort);
		activeSearchResults = matches;
		activeSearchPage = initialPage;
		if (pushHistory) setSearchUrl(options, initialPage, false);
		renderSearchResults(initialPage);
	} catch (error) {
		if (error.name === "AbortError" || searchController !== controller) return;
		status.textContent = `Search failed: ${error.message}`;
		status.className = "error";
	}
}

function navigateToPage(page) {
	if (activeSearchResults !== null) {
		activeSearchPage = page;
		setSearchUrl(activeSearchOptions, page, true);
		renderSearchResults(page);
		return;
	}
	openPage(page, true);
}

searchForm.addEventListener("submit", (event) => {
	event.preventDefault();
	searchArchive();
});

searchSortSelect.addEventListener("change", () => {
	if (!activeSearchOptions) return;
	const options = getSearchOptions();
	if (options.author !== activeSearchOptions.author || options.terms.join("\0") !== activeSearchOptions.terms.join("\0")) return;
	activeSearchOptions.sort = options.sort;
	activeSearchKey = searchKey(activeSearchOptions);
	setSearchUrl(activeSearchOptions, 1, true);
	if (activeSearchResults !== null) {
		sortSearchResults(activeSearchResults, options.sort);
		renderSearchResults(1);
	}
});

document.querySelector("#search-clear").addEventListener("click", () => {
	searchController?.abort();
	searchForm.reset();
	activeSearchResults = null;
	activeSearchOptions = null;
	activeSearchKey = "";
	const url = new URL(window.location.href);
	for (const key of ["search", "q", "author", "sort", "result_page"]) url.searchParams.delete(key);
	window.history.pushState({ mode: "archive" }, "", url);
	if (manifest) openPage(getCurrentPage(manifest.total_pages));
});

async function openPage(page, updateHistory = false) {
	const selectedPage = Math.min(Math.max(1, page), manifest.total_pages);
	const pageInfo = manifest.pages[selectedPage - 1];
	if (updateHistory) {
		const url = new URL(window.location.href);
		url.searchParams.set("page", String(selectedPage));
		window.history.pushState({ page: selectedPage }, "", url);
	}
	pageController?.abort();
	pageController = new AbortController();
	status.textContent = `Loading page ${selectedPage.toLocaleString()}…`;
	status.className = "archive-count";
	try {
		const response = await fetch(`data/archive/${pageInfo.file}`, { signal: pageController.signal });
		if (!response.ok) throw new Error(`Could not load page ${selectedPage} (${response.status})`);
		const pageData = await response.json();
		if (pageData.page !== selectedPage || !Array.isArray(pageData.messages)) {
			throw new Error(`The archive page ${selectedPage} is invalid.`);
		}
		render(pageData.messages, manifest, selectedPage);
		if (window.location.hash.startsWith("#message-")) {
			const messageId = decodeURIComponent(window.location.hash.slice(9));
			requestAnimationFrame(() => document.getElementById(`message-${messageId}`)?.scrollIntoView({ block: "start" }));
		}
	} catch (error) {
		if (error.name === "AbortError") return;
		status.textContent = `Unable to display page ${selectedPage}: ${error.message}`;
		status.className = "error";
	}
}

for (const pager of pagers) {
	pager.addEventListener("click", (event) => {
		const jumpButton = event.target.closest("button[data-page-jump]");
		if (jumpButton) {
			const pageCount = Number(jumpButton.dataset.pageCount);
			const form = document.createElement("form");
			form.className = "archive-page-jump";
			form.innerHTML = `<input type="number" min="1" max="${pageCount}" step="1" required placeholder="Page" aria-label="Page number"><button type="submit">Go</button>`;
			form.addEventListener("submit", (submitEvent) => {
				submitEvent.preventDefault();
				const input = form.querySelector("input");
				if (!input.checkValidity()) {
					input.reportValidity();
					return;
				}
				navigateToPage(input.valueAsNumber);
				window.scrollTo({ top: 0, behavior: "smooth" });
			});
			form.addEventListener("keydown", (keyEvent) => {
				if (keyEvent.key === "Escape") form.replaceWith(jumpButton);
			});
			jumpButton.replaceWith(form);
			form.querySelector("input").focus();
			return;
		}
		const button = event.target.closest("button[data-page]");
		if (!button || button.disabled) return;
		navigateToPage(Number(button.dataset.page));
		window.scrollTo({ top: 0, behavior: "smooth" });
	});
}

window.addEventListener("popstate", () => {
	if (!manifest) return;
	const params = new URLSearchParams(window.location.search);
	if (params.get("search") === "1") {
		searchTermsInput.value = params.get("q") || "";
		searchAuthorInput.value = params.get("author") || "";
		if (["relevant", "newest", "oldest"].includes(params.get("sort"))) searchSortSelect.value = params.get("sort");
		const options = getSearchOptions();
		if (activeSearchResults !== null && activeSearchKey === searchKey(options)) {
			renderSearchResults(Number(params.get("result_page")) || 1);
		} else searchArchive({ pushHistory: false, initialPage: Number(params.get("result_page")) || 1 });
		return;
	}
	searchController?.abort();
	activeSearchResults = null;
	activeSearchOptions = null;
	searchForm.reset();
	openPage(getCurrentPage(manifest.total_pages));
});

fetch(INDEX_URL)
	.then((response) => {
		if (!response.ok) throw new Error(`Could not load archive index (${response.status})`);
		return response.json();
	})
	.then((index) => {
		if (!Array.isArray(index.pages) || !index.total_pages || !index.page_size) {
			throw new Error("The archive index is invalid. Rebuild it with build_archive.py.");
		}
		manifest = index;
		for (const page of index.pages) {
			for (const messageId of page.message_ids || []) messagePages.set(String(messageId), page.number);
		}
		summary.textContent = `${displayNation(index.region)} · ${index.total_messages.toLocaleString()} messages · ${index.page_size} per page`;
		const initialPage = getCurrentPage(index.total_pages);
		if (!new URLSearchParams(window.location.search).has("page")) {
			const url = new URL(window.location.href);
			url.searchParams.set("page", String(initialPage));
			window.history.replaceState({ page: initialPage }, "", url);
		}
		const params = new URLSearchParams(window.location.search);
		if (params.get("search") === "1") {
			searchTermsInput.value = params.get("q") || "";
			searchAuthorInput.value = params.get("author") || "";
			if (["relevant", "newest", "oldest"].includes(params.get("sort"))) searchSortSelect.value = params.get("sort");
			searchArchive({ pushHistory: false, initialPage: Number(params.get("result_page")) || 1 });
		} else openPage(initialPage);
	})
	.catch((error) => {
		status.textContent = `Unable to display the archive: ${error.message}. Open this page through a local web server and rebuild the archive index if needed.`;
		status.className = "error";
	});
