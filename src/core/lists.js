// A frontmatter value as a list (one copy for every part of LifeWorld; phase 1 section 6,
// before a verbatim copy each in Today, Planner and Projects).
'use strict';

/** @param {unknown} v @returns {unknown[]} */
function asList(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]); }

export { asList };
