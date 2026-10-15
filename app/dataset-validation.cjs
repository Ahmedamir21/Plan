/** Shared checks for the admin review and the CLI release gate. No academic facts live here. */
function validateDataset({ semester, courses, sch, majors }) {
  const errors = [], warnings = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  check(semester && typeof semester === 'object' && !Array.isArray(semester), 'semester.json must be an object.');
  if (semester && typeof semester === 'object' && !Array.isArray(semester)) {
    check(typeof semester.key === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(semester.key) && semester.key.includes(String(semester.year)), 'Semester key must be a unique year-bearing slug.');
    check(typeof semester.term === 'string' && semester.term.trim() && Number.isInteger(semester.year) && semester.year >= 2020 && typeof semester.session === 'string' && semester.session.trim(), 'Semester term, year or session is missing.');
    check(validDate(semester.calendarStartDate) && validDate(semester.calendarEndDate) && semester.calendarStartDate <= semester.calendarEndDate, 'Invalid calendar start/end dates.');
    check(validDate(semester.dataLastVerified), 'Invalid verification date.');
  }
  for (const [name, value] of [['courses', courses], ['sch', sch], ['majors', majors]]) check(Array.isArray(value), `${name}.json must be an array.`);
  const all = [...(Array.isArray(courses) ? courses : []), ...(Array.isArray(sch) ? sch : [])];
  const ids = new Set(), codes = new Set(), majorIds = new Set();
  let meetings = 0, missingRooms = 0, unassigned = 0;
  for (const [index, course] of all.entries()) {
    if (!course || typeof course !== 'object' || Array.isArray(course)) { errors.push(`Course ${index + 1} is not an object.`); continue; }
    const label = course.code || course.id || `Course ${index + 1}`;
    check(typeof course.id === 'string' && course.id.trim() && !ids.has(course.id), `${label}: missing or duplicate course ID.`);
    ids.add(course.id);
    check(typeof course.code === 'string' && course.code.trim() && !codes.has(`${index < (courses?.length || 0) ? 'courses' : 'sch'}:${course.code.toUpperCase()}`), `${label}: missing or duplicate course code.`);
    if (typeof course.code === 'string') codes.add(`${index < (courses?.length || 0) ? 'courses' : 'sch'}:${course.code.toUpperCase()}`);
    check(typeof course.name === 'string' && course.name.trim(), `${label}: missing course name.`);
    check(Number.isInteger(course.c) && course.c >= 1 && course.c <= 7, `${label}: palette index must be 1–7.`);
    check(course.credits === undefined || Number.isFinite(course.credits) && course.credits >= 0 && course.credits <= 21, `${label}: invalid credits.`);
    const pendingEnglish = course.awaitingSource === true && /^ENGL (003|004|156|157)$/.test(course.code);
    check(Array.isArray(course.instructors) && (course.instructors.length > 0 || pendingEnglish), `${label}: missing instructor groups.`);
    if (course.awaitingSource) check(pendingEnglish && course.noFixedSchedule === true && course.credits === undefined && course.name === course.code && course.instructors?.length === 0, `${label}: incomplete English shell has unexpected published metadata.`);
    if (!Array.isArray(course.instructors)) continue;
    const sectionIds = new Set();
    let count = 0;
    for (const [teacherIndex, teacher] of course.instructors.entries()) {
      if (!teacher || typeof teacher !== 'object') { errors.push(`${label}: instructor group ${teacherIndex + 1} invalid.`); continue; }
      check(typeof teacher.name === 'string' && teacher.name.trim(), `${label}: instructor name missing.`);
      if (/^\s*(instructor\s+not\s+assigned|tba)\s*$/i.test(teacher.name || '')) check(teacher.unassigned === true, `${label}: unassigned instructor must have unassigned: true.`);
      if (teacher.unassigned) unassigned++;
      for (const [group, type] of [['lectures', 'Lecture'], ['labs', 'Lab'], ['tutorials', 'Tutorial']]) {
        check(Array.isArray(teacher[group]), `${label}: missing ${group} array.`);
        if (!Array.isArray(teacher[group])) continue;
        for (const meeting of teacher[group]) {
          count++; meetings++;
          if (!meeting || typeof meeting !== 'object') { errors.push(`${label}: invalid meeting.`); continue; }
          check(meeting.type === type, `${label}: ${group} must contain ${type} meetings.`);
          check(typeof meeting.sec === 'string' && meeting.sec.trim(), `${label}: missing section.`);
          const key = `${type}:${meeting.sec}`;
          check(!sectionIds.has(key), `${label}: duplicate ${type} section ${meeting.sec}.`);
          sectionIds.add(key);
          check(['Sun','Mon','Tue','Wed','Thu'].includes(meeting.day) && Number.isInteger(meeting.start) && Number.isInteger(meeting.end) && meeting.start >= 0 && meeting.end <= 1440 && meeting.start < meeting.end, `${label} ${type} ${meeting.sec}: invalid day or time.`);
          check(typeof meeting.room === 'string', `${label} ${type} ${meeting.sec}: room must be a string or empty when unpublished.`);
          if (!meeting.room) { missingRooms++; warnings.push(`${label} ${type} ${meeting.sec}: room not published.`); }
        }
      }
    }
    check(course.noFixedSchedule ? count === 0 : count > 0, `${label}: fixed-schedule status conflicts with its published meetings.`);
  }
  if (Array.isArray(majors)) for (const major of majors) {
    if (!major || typeof major !== 'object') { errors.push('Invalid major.'); continue; }
    check(typeof major.id === 'string' && major.id.trim() && !majorIds.has(major.id), `${major.id}: duplicate or missing major ID.`);
    majorIds.add(major.id);
    check(typeof major.title === 'string' && major.title.trim() && Array.isArray(major.years), `${major.id}: missing title or years.`);
    if (!Array.isArray(major.years)) continue;
    const years = new Set();
    for (const year of major.years) {
      if (!year || typeof year !== 'object') { errors.push(`${major.id}: invalid year.`); continue; }
      check(['y1','y2','y3','y4'].includes(year.id) && !years.has(year.id), `${major.id}: duplicate/invalid year ${year.id}.`);
      years.add(year.id);
      check(typeof year.label === 'string' && year.label.trim() && Array.isArray(year.courseIds), `${major.id}/${year.id}: missing label or course IDs.`);
      if (!Array.isArray(year.courseIds)) continue;
      check(new Set(year.courseIds).size === year.courseIds.length, `${major.id}/${year.id}: duplicate course reference.`);
      for (const id of year.courseIds) check(ids.has(id), `${major.id}/${year.id}: unknown course ${id}.`);
    }
  }
  return { errors, warnings, summary: { courses: all.length, meetings, sch: Array.isArray(sch) ? sch.length : 0, missingRooms, unassigned } };
}

module.exports = { validateDataset };
