/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

interface PrefillOption {
	id: number
}

export interface PrefillQuestion {
	id: number
	text: string
	type: string
	options?: PrefillOption[]
	extraSettings?: Record<string, unknown>
}

export interface RawPrefill {
	key: string
	values: string[]
}

export interface PrefillResult {
	answers: Record<number, string[]>
	hasPrefillParameters: boolean
}

const MAX_PREFILL_QUESTIONS = 100
const MAX_VALUES_PER_QUESTION = 100
const PREFILL_KEY_PATTERN = /^prefill\[([^\]]+)\](?:\[\])?$/
const QUESTION_ID_PATTERN = /^q_(\d+)$/
const QUESTION_NAME_PREFIX = 'n_'
const SUPPORTED_SINGLE_VALUE_TYPES = new Set(['short', 'long'])

/**
 * Extract supported prefill parameters while preserving their URL order.
 *
 * @param search URL query string
 */
export function parsePrefillQuery(search: string): RawPrefill[] {
	const params = new URLSearchParams(search)
	const grouped = new Map<string, string[]>()

	for (const [parameter, value] of params) {
		const match = PREFILL_KEY_PATTERN.exec(parameter)
		if (!match) {
			continue
		}

		const key = match[1]
		if (!grouped.has(key)) {
			if (grouped.size >= MAX_PREFILL_QUESTIONS) {
				continue
			}
			grouped.set(key, [])
		}

		const values = grouped.get(key)!
		if (values.length < MAX_VALUES_PER_QUESTION) {
			values.push(value)
		}
	}

	return Array.from(grouped, ([key, values]) => ({ key, values }))
}

/**
 * Resolve a stable q_<id> parameter.
 *
 * @param questions Questions available on the form
 * @param key Prefill parameter key
 */
export function resolveQuestionById(
	questions: PrefillQuestion[],
	key: string,
): PrefillQuestion | undefined {
	const match = QUESTION_ID_PATTERN.exec(key)
	if (!match) {
		return undefined
	}

	const id = Number(match[1])
	return questions.find((question) => question.id === id)
}

/**
 * Resolve an n_<text> parameter to the first question whose title contains text.
 *
 * @param questions Questions available on the form
 * @param key Prefill parameter key
 */
export function resolveQuestionByName(
	questions: PrefillQuestion[],
	key: string,
): PrefillQuestion | undefined {
	if (!key.startsWith(QUESTION_NAME_PREFIX)) {
		return undefined
	}

	const name = key.slice(QUESTION_NAME_PREFIX.length).trim()
	if (name === '') {
		return undefined
	}

	return questions.find((question) => question.text.includes(name))
}

/**
 * Check the strict YYYY-MM-DD storage format and calendar date.
 *
 * @param value Candidate date
 */
function isValidDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
	if (!match) {
		return false
	}

	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const date = new Date(Date.UTC(year, month - 1, day))

	return (
		date.getUTCFullYear() === year
		&& date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day
	)
}

/**
 * Check the strict HH:mm storage format.
 *
 * @param value Candidate time
 */
function isValidTime(value: string): boolean {
	return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/**
 * Check the strict YYYY-MM-DD HH:mm storage format.
 *
 * @param value Candidate date and time
 */
function isValidDateTime(value: string): boolean {
	const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(value)
	return match !== null && isValidDate(match[1]) && isValidTime(match[2])
}

/**
 * Normalize date, time, datetime, and supported range answers.
 *
 * @param question Question definition
 * @param values Candidate values
 */
function normalizeDateTime(
	question: PrefillQuestion,
	values: string[],
): string[] | undefined {
	const range =
		(question.type === 'date' && question.extraSettings?.dateRange === true)
		|| (question.type === 'time' && question.extraSettings?.timeRange === true)
	const expectedLength = range ? 2 : 1

	if (values.length !== expectedLength) {
		return undefined
	}

	const validator =
		question.type === 'date'
			? isValidDate
			: question.type === 'time'
				? isValidTime
				: isValidDateTime
	if (!values.every(validator)) {
		return undefined
	}

	if (range && values[0] > values[1]) {
		return undefined
	}

	return values
}

/**
 * Normalize choice IDs and enforce configured selection limits.
 *
 * @param question Question definition
 * @param values Candidate option IDs
 */
function normalizeOptionValues(
	question: PrefillQuestion,
	values: string[],
): string[] | undefined {
	const optionIds = new Set(
		(question.options ?? []).map((option) => String(option.id)),
	)
	const normalized = Array.from(
		new Set(values.filter((value) => optionIds.has(value))),
	)

	if (normalized.length === 0) {
		return undefined
	}

	if (question.type === 'multiple') {
		if (values.some((value) => !optionIds.has(value))) {
			return undefined
		}
		const minimum = Number(question.extraSettings?.optionsLimitMin ?? 0)
		const maximum = Number(question.extraSettings?.optionsLimitMax ?? 0)
		if (
			(minimum > 0 && normalized.length < minimum)
			|| (maximum > 0 && normalized.length > maximum)
		) {
			return undefined
		}
		return normalized
	}

	return values.length === 1 && normalized.length === 1 ? normalized : undefined
}

/**
 * Normalize a value within the configured linear scale.
 *
 * @param question Question definition
 * @param values Candidate values
 */
function normalizeLinearScale(
	question: PrefillQuestion,
	values: string[],
): string[] | undefined {
	if (values.length !== 1 || !/^\d+$/.test(values[0])) {
		return undefined
	}

	const value = Number(values[0])
	const lowest = Number(question.extraSettings?.optionsLowest ?? 1)
	const highest = Number(question.extraSettings?.optionsHighest ?? 5)

	return value >= lowest && value <= highest ? [String(value)] : undefined
}

/**
 * Normalize a complete, unique ordering of ranking options.
 *
 * @param question Question definition
 * @param values Candidate ordered option IDs
 */
function normalizeRanking(
	question: PrefillQuestion,
	values: string[],
): string[] | undefined {
	const optionIds = new Set(
		(question.options ?? []).map((option) => String(option.id)),
	)
	const uniqueValues = new Set(values)

	if (
		values.length === 0
		|| values.length !== optionIds.size
		|| uniqueValues.size !== values.length
		|| !values.every((value) => optionIds.has(value))
	) {
		return undefined
	}

	return values
}

/**
 * Dispatch candidate values to the supported question normalizer.
 *
 * @param question Question definition
 * @param values Candidate values
 * @param maxAnswerLength Maximum permitted raw answer length
 */
function normalizeAnswer(
	question: PrefillQuestion,
	values: string[],
	maxAnswerLength: number,
): string[] | undefined {
	if (
		values.length === 0
		|| values.some((value) => value === '' || value.length > maxAnswerLength)
	) {
		return undefined
	}

	if (SUPPORTED_SINGLE_VALUE_TYPES.has(question.type)) {
		return values.length === 1 ? values : undefined
	}

	switch (question.type) {
		case 'color':
			return values.length === 1 && /^#[\da-f]{6}$/i.test(values[0])
				? values
				: undefined
		case 'date':
		case 'datetime':
		case 'time':
			return normalizeDateTime(question, values)
		case 'multiple':
		case 'multiple_unique':
		case 'dropdown':
			return normalizeOptionValues(question, values)
		case 'linearscale':
			return normalizeLinearScale(question, values)
		case 'ranking':
			return normalizeRanking(question, values)
		default:
			// File and grid questions are intentionally unsupported.
			return undefined
	}
}

/**
 * Convert URL values into the answer representation consumed by Submit.vue.
 *
 * q_<id> parameters are resolved before n_<text> aliases. LocalStorage priority
 * is applied by Submit.vue after this result has been merged into its state.
 *
 * @param questions Questions available on the form
 * @param rawPrefill Parsed prefill parameters
 * @param maxAnswerLength Maximum permitted raw answer length
 */
export function normalizePrefillAnswers(
	questions: PrefillQuestion[],
	rawPrefill: RawPrefill[],
	maxAnswerLength: number,
): PrefillResult {
	const answers: Record<number, string[]> = {}
	const claimedByName = new Set<number>()
	const orderedPrefill = [
		...rawPrefill.filter(({ key }) => QUESTION_ID_PATTERN.test(key)),
		...rawPrefill.filter(({ key }) => !QUESTION_ID_PATTERN.test(key)),
	]

	for (const { key, values } of orderedPrefill) {
		const byId = QUESTION_ID_PATTERN.test(key)
		const question = byId
			? resolveQuestionById(questions, key)
			: resolveQuestionByName(questions, key)
		if (
			!question
			|| (!byId && (claimedByName.has(question.id) || answers[question.id]))
		) {
			continue
		}

		const normalized = normalizeAnswer(question, values, maxAnswerLength)
		if (!normalized) {
			continue
		}

		answers[question.id] = normalized
		if (!byId) {
			claimedByName.add(question.id)
		}
	}

	return {
		answers,
		hasPrefillParameters: rawPrefill.length > 0,
	}
}
