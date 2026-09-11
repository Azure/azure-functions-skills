import assert from "node:assert/strict";
import { test } from "./vitest-test.mjs";
import {
	describeTimerSchedule,
	normalizeTimerSchedule,
	replaceTimerScheduleExpression,
	timerExpressionFromSchedule,
	timerScheduleFromExpression,
} from "../timer-schedule.mjs";

test("daily schedules preserve local-time semantics in NCRONTAB", () => {
	const schedule = { cadence: "daily", localTime: "09:15" };
	assert.equal(timerExpressionFromSchedule(schedule, 420), "0 15 16 * * *");
	assert.deepEqual(timerScheduleFromExpression("0 15 16 * * *", 420), {
		cadence: "daily",
		localTime: "09:15",
		weekday: 1,
		hourlyMinute: 0,
		expression: "0 15 16 * * *",
		status: "Runs daily at 09:15 local time",
		error: "",
	});
});

test("weekly schedules shift the UTC weekday when local time crosses midnight", () => {
	const pacificSunday = { cadence: "weekly", weekday: 0, localTime: "22:30" };
	assert.equal(timerExpressionFromSchedule(pacificSunday, 420), "0 30 5 * * 1");
	assert.deepEqual(timerScheduleFromExpression("0 30 5 * * 1", 420), {
		cadence: "weekly",
		localTime: "22:30",
		weekday: 0,
		hourlyMinute: 0,
		expression: "0 30 5 * * 1",
		status: "Runs weekly on Sunday at 22:30 local time",
		error: "",
	});

	const sydneyMonday = { cadence: "weekly", weekday: 1, localTime: "01:00" };
	assert.equal(timerExpressionFromSchedule(sydneyMonday, -600), "0 0 15 * * 0");
	assert.equal(describeTimerSchedule(sydneyMonday), "Runs weekly on Monday at 01:00 local time");
});

test("hourly schedules use a minute offset without timezone conversion", () => {
	const schedule = { cadence: "hourly", hourlyMinute: 45 };
	assert.equal(timerExpressionFromSchedule(schedule, 420), "0 45 * * * *");
	assert.deepEqual(timerScheduleFromExpression("0 45 * * * *", -600), {
		cadence: "hourly",
		localTime: "09:00",
		weekday: 1,
		hourlyMinute: 45,
		expression: "0 45 * * * *",
		status: "Runs hourly at minute 45",
		error: "",
	});
});

test("schedule validation rejects invalid cadence-specific values and unsupported expressions", () => {
	assert.throws(() => normalizeTimerSchedule({ cadence: "weekly", weekday: 7, localTime: "09:00" }), /weekday/);
	assert.throws(() => normalizeTimerSchedule({ cadence: "hourly", hourlyMinute: 60 }), /minute/);
	assert.throws(() => timerExpressionFromSchedule({ cadence: "daily", localTime: "25:00" }), /local time/);
	assert.equal(timerScheduleFromExpression("0 */15 * * * *"), null);
	assert.equal(timerScheduleFromExpression("0 0 9 1 * *"), null);
});

test("generated Timer source updates only the schedule setting", () => {
	const source = "---\nname: Digest\nschedule: '0 0 16 * * *'\ndescription: Test\n---\n\nInstructions\n";
	assert.equal(
		replaceTimerScheduleExpression(source, "0 30 5 * * 1"),
		"---\nname: Digest\nschedule: \"0 30 5 * * 1\"\ndescription: Test\n---\n\nInstructions\n",
	);
	assert.throws(() => replaceTimerScheduleExpression("---\nname: Digest\n---\n", "0 0 * * * *"), /schedule setting/);
});
