import { setupPopovers } from './popover.js';
import { setupMasonries } from './masonry.js';
import { throttledDebounce, isElementVisible, openURLInNewTab } from './utils.js';


function setupCarousels() {
    const carouselElements = document.getElementsByClassName("carousel-container");
    if (carouselElements.length === 0) return;

    for (let i = 0; i < carouselElements.length; i++) {
        const carousel = carouselElements[i];
        carousel.classList.add("show-right-cutoff");
        const itemsContainer = carousel.getElementsByClassName("carousel-items-container")[0];

        const determineSideCutoffs = () => {
            if (itemsContainer.scrollLeft !== 0) {
                carousel.classList.add("show-left-cutoff");
            } else {
                carousel.classList.remove("show-left-cutoff");
            }

            if (Math.ceil(itemsContainer.scrollLeft) + itemsContainer.clientWidth < itemsContainer.scrollWidth) {
                carousel.classList.add("show-right-cutoff");
            } else {
                carousel.classList.remove("show-right-cutoff");
            }
        };

        const determineSideCutoffsRateLimited = throttledDebounce(determineSideCutoffs, 20, 100);

        itemsContainer.addEventListener("scroll", determineSideCutoffsRateLimited);
        window.addEventListener("resize", determineSideCutoffsRateLimited);

        afterContentReady(determineSideCutoffs);
    }
}

const minuteInSeconds = 60;
const hourInSeconds = minuteInSeconds * 60;
const dayInSeconds = hourInSeconds * 24;
const monthInSeconds = dayInSeconds * 30.4;
const yearInSeconds = dayInSeconds * 365;

function timestampToRelativeTime(timestamp) {
    let delta = Math.round((Date.now() / 1000) - timestamp);
    let prefix = "";

    if (delta < 0) {
        delta = -delta;
        prefix = "in ";
    }

    if (delta < minuteInSeconds) {
        return prefix + "1m";
    }
    if (delta < hourInSeconds) {
        return prefix + Math.floor(delta / minuteInSeconds) + "m";
    }
    if (delta < dayInSeconds) {
        return prefix + Math.floor(delta / hourInSeconds) + "h";
    }
    if (delta < monthInSeconds) {
        return prefix + Math.floor(delta / dayInSeconds) + "d";
    }
    if (delta < yearInSeconds) {
        return prefix + Math.floor(delta / monthInSeconds) + "mo";
    }

    return prefix + Math.floor(delta / yearInSeconds) + "y";
}


function updateRelativeTimeForElements(elements) {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        const timestamp = element.dataset.dynamicRelativeTime;
        if (!timestamp) continue;
        element.textContent = timestampToRelativeTime(parseInt(timestamp, 10));
    }
}

function setupDynamicRelativeTime() {
    const elements = document.querySelectorAll("[data-dynamic-relative-time]");
    if (!elements.length) return;

    const updateInterval = 60 * 1000;
    let lastUpdateTime = Date.now();

    updateRelativeTimeForElements(elements);

    const updateElementsAndTimestamp = () => {
        updateRelativeTimeForElements(elements);
        lastUpdateTime = Date.now();
    };

    const scheduleRepeatingUpdate = () => setInterval(updateElementsAndTimestamp, updateInterval);

    if (document.hidden === undefined) {
        scheduleRepeatingUpdate();
        return;
    }

    let timeout = scheduleRepeatingUpdate();

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            clearTimeout(timeout);
            return;
        }
        const delta = Date.now() - lastUpdateTime;
        if (delta >= updateInterval) {
            updateElementsAndTimestamp();
            timeout = scheduleRepeatingUpdate();
            return;
        }
        timeout = setTimeout(() => {
            updateElementsAndTimestamp();
            timeout = scheduleRepeatingUpdate();
        }, updateInterval - delta);
    });
}


function setupSearchBoxes() {
    const searchWidgets = document.getElementsByClassName("search");
    if (!searchWidgets.length) return;

    for (let i = 0; i < searchWidgets.length; i++) {
        const widget = searchWidgets[i];
        const defaultSearchUrl = widget.dataset.defaultSearchUrl;
        const newTab = widget.dataset.newTab === "true";
        const inputElement = widget.getElementsByClassName("search-input")[0];
        const bangElement = widget.getElementsByClassName("search-bang")[0];
        const bangs = widget.querySelectorAll(".search-bangs > input");
        const bangsMap = {};
        const kbdElement = widget.getElementsByTagName("kbd")[0];
        let currentBang = null;
        let lastQuery = "";

        for (let j = 0; j < bangs.length; j++) {
            const bang = bangs[j];
            bangsMap[bang.dataset.shortcut] = bang;
        }

        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                inputElement.blur();
                return;
            }
            if (event.key === "Enter") {
                const input = inputElement.value.trim();
                let query;
                let searchUrlTemplate;

                if (currentBang != null) {
                    query = input.slice(currentBang.dataset.shortcut.length + 1);
                    searchUrlTemplate = currentBang.dataset.url;
                } else {
                    query = input;
                    searchUrlTemplate = defaultSearchUrl;
                }
                if (!query && !currentBang) return;

                const url = searchUrlTemplate.replace("!QUERY!", encodeURIComponent(query));

                if (newTab && !event.ctrlKey || !newTab && event.ctrlKey) {
                    window.open(url, '_blank')?.focus();
                } else {
                    window.location.href = url;
                }

                lastQuery = query;
                inputElement.value = "";
                return;
            }
            if (event.key === "ArrowUp" && lastQuery.length > 0) {
                inputElement.value = lastQuery;
                return;
            }
        };

        const changeCurrentBang = (bang) => {
            currentBang = bang;
            bangElement.textContent = bang ? bang.dataset.title : "";
        };

        const handleInput = (event) => {
            const value = event.target.value.trim();
            if (value in bangsMap) {
                changeCurrentBang(bangsMap[value]);
                return;
            }
            const words = value.split(" ");
            if (words.length >= 2 && words[0] in bangsMap) {
                changeCurrentBang(bangsMap[words[0]]);
                return;
            }
            changeCurrentBang(null);
        };

        inputElement.addEventListener("focus", () => {
            document.addEventListener("keydown", handleKeyDown);
            document.addEventListener("input", handleInput);
        });
        inputElement.addEventListener("blur", () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("input", handleInput);
        });

        document.addEventListener("keydown", (event) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            if (event.key === "s" || event.key === "S") {
                inputElement.focus();
                event.preventDefault();
            }
        });

        if (kbdElement) {
            kbdElement.addEventListener("mousedown", () => {
                requestAnimationFrame(() => inputElement.focus());
            });
        }
    }
}

function setupGroups() {
    const groups = document.getElementsByClassName("widget-type-group");
    if (!groups.length) return;

    for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const titles = group.getElementsByClassName("widget-header")[0].children;
        const tabs = group.getElementsByClassName("widget-group-contents")[0].children;
        let current = 0;

        for (let t = 0; t < titles.length; t++) {
            const title = titles[t];
            title.addEventListener("click", () => {
                if (t === current) {
                    const url = title.dataset.titleUrl;
                    if (url) openURLInNewTab(url);
                    return;
                }
                for (let i = 0; i < titles.length; i++) {
                    titles[i].classList.remove("widget-group-title-current");
                    titles[i].setAttribute("aria-selected", "false");
                    tabs[i].classList.remove("widget-group-content-current");
                    tabs[i].setAttribute("aria-hidden", "true");
                }
                if (current < t) {
                    tabs[t].dataset.direction = "right";
                } else {
                    tabs[t].dataset.direction = "left";
                }
                current = t;
                titleButton.classList.add("widget-group-title-current");
                titleButton.setAttribute("aria-selected", "true");
                tabs[t].classList.add("widget-group-content-current");
                tabs[t].setAttribute("aria-hidden", "false");
            });
        }
    }
}


function setupLazyImages() {
    const images = document.querySelectorAll("img[loading=lazy]");
    if (!images.length) return;

    function imageFinishedTransition(image) {
        image.classList.add("finished-transition");
    }

    afterContentReady(() => {
        setTimeout(() => {
            for (let i = 0; i < images.length; i++) {
                const image = images[i];

                if (image.complete) {
                    image.classList.add("cached");
                    setTimeout(() => imageFinishedTransition(image), 1);
                } else {
                    // TODO: also handle error event
                    image.addEventListener("load", () => {
                        image.classList.add("loaded");
                        setTimeout(() => imageFinishedTransition(image), 400);
                    });
                }
            }
        }, 1);
    });
}

const contentReadyCallbacks = [];
function afterContentReady(callback) {
    contentReadyCallbacks.push(callback);
}

function attachExpandToggleButton(collapsibleContainer) {
    const showMoreText = "Show more";
    const showLessText = "Show less";

    let expanded = false;
    const button = document.createElement("button");
    const icon = document.createElement("span");
    icon.classList.add("expand-toggle-button-icon");
    const textNode = document.createTextNode(showMoreText);
    button.classList.add("expand-toggle-button");
    button.append(textNode, icon);
    button.addEventListener("click", () => {
        expanded = !expanded;

        if (expanded) {
            collapsibleContainer.classList.add("container-expanded");
            button.classList.add("container-expanded");
            textNode.nodeValue = showLessText;
        } else {
            const topBefore = button.getClientRects()[0].top;
            collapsibleContainer.classList.remove("container-expanded");
            button.classList.remove("container-expanded");
            textNode.nodeValue = showMoreText;
            const topAfter = button.getClientRects()[0].top;
            if (topAfter < 0) {
                window.scrollBy({
                    top: topAfter - topBefore,
                    behavior: "instant"
                });
            }
        }
    });

    collapsibleContainer.after(button);
    return button;
}

function setupCollapsibleLists() {
    const collapsibleLists = document.querySelectorAll(".list.collapsible-container");
    if (!collapsibleLists.length) return;

    for (let i = 0; i < collapsibleLists.length; i++) {
        const list = collapsibleLists[i];
        if (list.dataset.collapseAfter === undefined) continue;
        const collapseAfter = parseInt(list.dataset.collapseAfter, 10);
        if (collapseAfter === -1) continue;
        if (list.children.length <= collapseAfter) continue;

        attachExpandToggleButton(list);

        for (let c = collapseAfter; c < list.children.length; c++) {
            const child = list.children[c];
            child.classList.add("collapsible-item");
            child.style.animationDelay = ((c - collapseAfter) * 20).toString() + "ms";
        }
    }
}

function setupCollapsibleGrids() {
    const collapsibleGridElements = document.querySelectorAll(".cards-grid.collapsible-container");
    if (!collapsibleGridElements.length) return;

    for (let i = 0; i < collapsibleGridElements.length; i++) {
        const gridElement = collapsibleGridElements[i];
        if (gridElement.dataset.collapseAfterRows === undefined) continue;
        const collapseAfterRows = parseInt(gridElement.dataset.collapseAfterRows, 10);
        if (collapseAfterRows === -1) continue;

        const button = attachExpandToggleButton(gridElement);
        let cardsPerRow;

        const getCardsPerRow = () => {
            return parseInt(getComputedStyle(gridElement).getPropertyValue('--cards-per-row'), 10);
        };

        const resolveCollapsibleItems = () => requestAnimationFrame(() => {
            const hideItemsAfterIndex = cardsPerRow * collapseAfterRows;

            if (hideItemsAfterIndex >= gridElement.children.length) {
                button.style.display = "none";
            } else {
                button.style.removeProperty("display");
            }

            let row = 0;
            for (let j = 0; j < gridElement.children.length; j++) {
                const child = gridElement.children[j];

                if (j >= hideItemsAfterIndex) {
                    child.classList.add("collapsible-item");
                    child.style.animationDelay = (row * 40).toString() + "ms";
                    if (j % cardsPerRow + 1 === cardsPerRow) row++;
                } else {
                    child.classList.remove("collapsible-item");
                    child.style.removeProperty("animation-delay");
                }
            }
        });

        const observer = new ResizeObserver(() => {
            if (!isElementVisible(gridElement)) return;
            const newCardsPerRow = getCardsPerRow();
            if (cardsPerRow === newCardsPerRow) return;
            cardsPerRow = newCardsPerRow;
            resolveCollapsibleItems();
        });
        afterContentReady(() => observer.observe(gridElement));
    }
}

function setupClocks() {
    const clocks = document.getElementsByClassName('clock');
    if (!clocks.length) return;

    const updateCallbacks = [];

    const weekDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    function makeSettableTimeElement(element, hourFormat) {
        const fragment = document.createDocumentFragment();
        const hour = document.createElement('span');
        const minute = document.createElement('span');
        const amPm = document.createElement('span');
        fragment.append(hour, document.createTextNode(':'), minute);
        if (hourFormat === '12h') {
            fragment.append(document.createTextNode(' '), amPm);
        }
        element.appendChild(fragment);

        return (date) => {
            const hours = date.getHours();

            if (hourFormat === '12h') {
                amPm.textContent = hours < 12 ? 'AM' : 'PM';
                hour.textContent = hours % 12 || 12;
            } else {
                hour.textContent = hours < 10 ? '0' + hours : hours;
            }

            const minutes = date.getMinutes();
            minute.textContent = minutes < 10 ? '0' + minutes : minutes;
        };
    }

    function timeInZone(now, zone) {
        let timeInZone;
        try {
            timeInZone = new Date(now.toLocaleString('en-US', { timeZone: zone }));
        } catch (e) {
            // TODO: indicate to the user that this is an invalid timezone
            console.error(e);
            timeInZone = now;
        }
        const diffInMinutes = Math.round((timeInZone.getTime() - now.getTime()) / 60000);
        return { time: timeInZone, diffInMinutes: diffInMinutes };
    }

    function zoneDiffText(diffInMinutes) {
        if (diffInMinutes === 0) {
            return { text: "", title: "" };
        }
        const sign = diffInMinutes < 0 ? "-" : "+";
        const signText = diffInMinutes < 0 ? "behind" : "ahead";
        const val = Math.abs(diffInMinutes);
        const hours = Math.floor(val / 60);
        const mins = val % 60;

        if (hours === 0 && mins > 0) {
            return { text: `${sign}${mins}m`, title: `${mins} minutes ${signText}` };
        }
        if (mins === 0 && hours > 0) {
            return { text: `${sign}${hours}h`, title: `${hours} hour${hours === 1 ? '' : 's'} ${signText}` };
        }
        return { text: `${sign}${hours}h~`, title: `${hours}h ${mins}m ${signText}` };
    }

    for (let i = 0; i < clocks.length; i++) {
        const clock = clocks[i];
        const hourFormat = clock.dataset.hourFormat;
        const localTimeContainer = clock.querySelector('[data-local-time]');
        if (!localTimeContainer) continue;
        const localDateElement = localTimeContainer.querySelector('[data-date]');
        const localWeekdayElement = localTimeContainer.querySelector('[data-weekday]');
        const localYearElement = localTimeContainer.querySelector('[data-year]');
        const setLocalTime = makeSettableTimeElement(
            localTimeContainer.querySelector('[data-time]'),
            hourFormat
        );

        updateCallbacks.push((now) => {
            setLocalTime(now);
            localDateElement.textContent = now.getDate() + ' ' + monthNames[now.getMonth()];
            localWeekdayElement.textContent = weekDayNames[now.getDay()];
            localYearElement.textContent = now.getFullYear();
        });

        const zones = clock.querySelectorAll('[data-time-in-zone]');
        for (let z = 0; z < zones.length; z++) {
            const zoneElement = zones[z];
            const diffSpan = zoneElement.querySelector('[data-time-diff]');
            const setZoneTime = makeSettableTimeElement(
                zoneElement.querySelector('[data-time]'),
                hourFormat
            );
            updateCallbacks.push((now) => {
                const { time, diffInMinutes } = timeInZone(now, zoneElement.dataset.timeInZone);
                setZoneTime(time);
                const { text, title } = zoneDiffText(diffInMinutes);
                diffSpan.textContent = text;
                diffSpan.title = title;
            });
        }
    }

    const updateClocks = () => {
        const now = new Date();
        for (let i = 0; i < updateCallbacks.length; i++) {
            updateCallbacks[i](now);
        }
        setTimeout(updateClocks, (60 - now.getSeconds()) * 1000);
    };
    updateClocks();
}

async function setupCalendars() {
    const elems = document.getElementsByClassName("calendar");
    if (!elems.length) return;

    // TODO: implement prefetching, currently loads as a nasty waterfall of requests
    const calendar = await import("./calendar.js");

    for (let i = 0; i < elems.length; i++) {
        calendar.default(elems[i]);
    }
}

function setupTruncatedElementTitles() {
    const elements = document.querySelectorAll(".text-truncate, .single-line-titles .title, .text-truncate-2-lines, .text-truncate-3-lines");
    if (!elements.length) return;
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.title === "") element.title = element.textContent;
    }
}

async function setupPage() {
    setupPopovers();
    setupMasonries();
    setupCarousels();
    setupSearchBoxes();
    setupGroups();
    setupLazyImages();
    setupCollapsibleLists();
    setupCollapsibleGrids();
    setupDynamicRelativeTime();
    setupClocks();
    await setupCalendars();

    const pageElement = document.getElementById("page");
    if (pageElement) {
        pageElement.classList.add("content-ready");
        pageElement.setAttribute("aria-busy", "false");
    }

    for (let i = 0; i < contentReadyCallbacks.length; i++) {
        contentReadyCallbacks[i]();
    }

    setTimeout(() => {
        setupTruncatedElementTitles();
    }, 50);

    setTimeout(() => {
        document.body.classList.add("page-columns-transitioned");
    }, 300);
}

setupPage();
