export const TIMER_CADENCES = ["daily", "weekly", "hourly"];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT_SCHEDULE = Object.freeze({
	cadence: "daily",
	localTime: "09:00",
	weekday: 1,
	hourlyMinute: 0,
});

function modulo(value, divisor) {
	return ((value % divisor) + divisor) % divisor;
}

function parseLocalTime(localTime) {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(localTime || ""));
	if (!match) throw new Error("Choose a valid local time.");
	return { hour: Number(match[1]), minute: Number(match[2]) };
}

function normalizeOffset(offsetMinutes) {
	const value = Number(offsetMinutes);
	if (!Number.isInteger(value)) throw new Error("The local timezone offset is invalid.");
	return value;
}

export function normalizeTimerSchedule(input = {}) {
	const cadence = String(input.cadence || DEFAULT_SCHEDULE.cadence).toLowerCase();
	if (!TIMER_CADENCES.includes(cadence)) throw new Error("Choose Daily, Weekly, or Hourly.");

	const localTime = String(input.localTime || DEFAULT_SCHEDULE.localTime);
	const weekday = Number(input.weekday ?? DEFAULT_SCHEDULE.weekday);
	const hourlyMinute = Number(input.hourlyMinute ?? DEFAULT_SCHEDULE.hourlyMinute);

	if (cadence === "daily" || cadence === "weekly") parseLocalTime(localTime);
	if (cadence === "weekly" && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
		throw new Error("Choose a valid weekday.");
	}
	if (cadence === "hourly" && (!Number.isInteger(hourlyMinute) || hourlyMinute < 0 || hourlyMinute > 59)) {
		throw new Error("Choose a minute from 0 through 59.");
	}

	return { cadence, localTime, weekday, hourlyMinute };
}

export function timerExpressionFromSchedule(input, offsetMinutes = new Date().getTimezoneOffset()) {
	const schedule = normalizeTimerSchedule(input);
	if (schedule.cadence === "hourly") return `0 ${schedule.hourlyMinute} * * * *`;

	const { hour, minute } = parseLocalTime(schedule.localTime);
	const utcTotal = hour * 60 + minute + normalizeOffset(offsetMinutes);
	const utcMinuteOfDay = modulo(utcTotal, 24 * 60);
	const utcHour = Math.floor(utcMinuteOfDay / 60);
	const utcMinute = utcMinuteOfDay % 60;
	if (schedule.cadence === "daily") return `0 ${utcMinute} ${utcHour} * * *`;

	const utcWeekday = modulo(schedule.weekday + Math.floor(utcTotal / (24 * 60)), 7);
	return `0 ${utcMinute} ${utcHour} * * ${utcWeekday}`;
}

export function timerScheduleFromExpression(expression, offsetMinutes = new Date().getTimezoneOffset()) {
	const fields = String(expression || "").trim().split(/\s+/);
	if (fields.length !== 6 || fields[0] !== "0" || fields[3] !== "*" || fields[4] !== "*") return null;

	const minute = Number(fields[1]);
	if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
	if (fields[2] === "*" && fields[5] === "*") {
		const schedule = normalizeTimerSchedule({ cadence: "hourly", hourlyMinute: minute });
		return { ...schedule, expression: String(expression).trim(), status: describeTimerSchedule(schedule), error: "" };
	}

	const hour = Number(fields[2]);
	if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
	const localTotal = hour * 60 + minute - normalizeOffset(offsetMinutes);
	const localMinuteOfDay = modulo(localTotal, 24 * 60);
	const localTime = `${String(Math.floor(localMinuteOfDay / 60)).padStart(2, "0")}:${String(localMinuteOfDay % 60).padStart(2, "0")}`;

	if (fields[5] === "*") {
		const schedule = normalizeTimerSchedule({ cadence: "daily", localTime });
		return { ...schedule, expression: String(expression).trim(), status: describeTimerSchedule(schedule), error: "" };
	}

	const utcWeekday = Number(fields[5]);
	if (!Number.isInteger(utcWeekday) || utcWeekday < 0 || utcWeekday > 6) return null;
	const localWeekday = modulo(utcWeekday + Math.floor(localTotal / (24 * 60)), 7);
	const schedule = normalizeTimerSchedule({ cadence: "weekly", localTime, weekday: localWeekday });
	return { ...schedule, expression: String(expression).trim(), status: describeTimerSchedule(schedule), error: "" };
}

export function describeTimerSchedule(input) {
	const schedule = normalizeTimerSchedule(input);
	if (schedule.cadence === "hourly") return `Runs hourly at minute ${schedule.hourlyMinute}`;
	if (schedule.cadence === "weekly") {
		return `Runs weekly on ${WEEKDAYS[schedule.weekday]} at ${schedule.localTime} local time`;
	}
	return `Runs daily at ${schedule.localTime} local time`;
}

export function replaceTimerScheduleExpression(source, expression) {
	const pattern = /^(\s*)schedule:\s*["']?[^"'\r\n]+["']?\s*$/m;
	if (!pattern.test(source)) throw new Error("The Timer agent does not contain a schedule setting.");
	return source.replace(pattern, `$1schedule: "${expression}"`);
}
