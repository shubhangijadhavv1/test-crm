"use strict";
// Branch weekend-policy helpers (shared by attendance & reporting).
Object.defineProperty(exports, "__esModule", { value: true });
exports.saturdayOrdinal = saturdayOrdinal;
exports.isWeeklyOff = isWeeklyOff;
exports.weekendDaysInMonth = weekendDaysInMonth;
exports.weekendLabel = weekendLabel;
/** Which Saturday of the month a date is (1..5). Only meaningful for Saturdays. */
function saturdayOrdinal(date) {
    return Math.ceil(date.getDate() / 7);
}
/** Is the given date a weekly-off under this branch policy? */
function isWeeklyOff(weekend, date) {
    const w = weekend || {};
    const dow = date.getDay(); // 0 = Sun, 6 = Sat
    if (dow === 0)
        return w.sundayOff !== false;
    if (dow === 6)
        return (w.saturdayWeeks || []).includes(saturdayOrdinal(date));
    return false;
}
/** All weekly-off dates (YYYY-MM-DD) in a given month (month is 1-12). */
function weekendDaysInMonth(weekend, year, month) {
    const out = [];
    const days = new Date(year, month, 0).getDate();
    for (let d = 1; d <= days; d++) {
        const date = new Date(year, month - 1, d);
        if (isWeeklyOff(weekend, date))
            out.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return out;
}
/** Human label e.g. "Sun + 2nd, 4th Sat" / "Sun only" / "No weekly off". */
function weekendLabel(weekend) {
    const w = weekend || {};
    const parts = [];
    if (w.sundayOff !== false)
        parts.push('Sun');
    const ord = ['', '1st', '2nd', '3rd', '4th', '5th'];
    const sats = (w.saturdayWeeks || []).slice().sort((a, b) => a - b).map((n) => ord[n]).filter(Boolean);
    if (sats.length === 5)
        parts.push('all Sat');
    else if (sats.length)
        parts.push(`${sats.join(', ')} Sat`);
    return parts.length ? parts.join(' + ') : 'No weekly off';
}
//# sourceMappingURL=weekend.js.map