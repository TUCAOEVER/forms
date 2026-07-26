/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	normalizePrefillAnswers,
	parsePrefillQuery,
	resolveQuestionById,
	resolveQuestionByName,
	resolveQuestionByOrder,
} from '../../src/utils/PrefillAnswers.ts'

const questions = [
	{
		id: 1,
		text: '请输入您的电子邮箱',
		type: 'short',
		options: [],
		extraSettings: {},
	},
	{
		id: 2,
		text: '请输入备用电子邮箱',
		type: 'long',
		options: [],
		extraSettings: {},
	},
	{
		id: 3,
		text: '选择水果',
		type: 'multiple',
		options: [
			{ id: 33, order: 3 },
			{ id: 31, order: 1 },
			{ id: 32, order: 2 },
		],
		extraSettings: { optionsLimitMin: 1, optionsLimitMax: 2 },
	},
	{
		id: 4,
		text: '选择国家',
		type: 'dropdown',
		options: [
			{ id: 42, order: 2 },
			{ id: 41, order: 1 },
		],
		extraSettings: {},
	},
	{
		id: 5,
		text: '选择日期范围',
		type: 'date',
		options: [],
		extraSettings: { dateRange: true },
	},
	{
		id: 6,
		text: '满意度',
		type: 'linearscale',
		options: [],
		extraSettings: { optionsLowest: 0, optionsHighest: 10 },
	},
	{
		id: 7,
		text: '排列优先级',
		type: 'ranking',
		options: [
			{ id: 72, order: 2 },
			{ id: 73, order: 3 },
			{ id: 71, order: 1 },
		],
		extraSettings: {},
	},
	{
		id: 8,
		text: '附件',
		type: 'file',
		options: [],
		extraSettings: {},
	},
	{
		id: 9,
		text: '矩阵',
		type: 'grid',
		options: [],
		extraSettings: {},
	},
	{
		id: 10,
		text: '选择唯一选项',
		type: 'multiple_unique',
		options: [
			{ id: 103, order: 3 },
			{ id: 101, order: 1 },
			{ id: 102, order: 2 },
			{ id: 199, order: 0, optionType: 'other' },
		],
		extraSettings: {},
	},
]

function normalize(search, selectedQuestions = questions) {
	return normalizePrefillAnswers(
		selectedQuestions,
		parsePrefillQuery(search),
		4096,
	)
}

describe('parsePrefillQuery', () => {
	it('extracts only prefill parameters and groups repeated values', () => {
		assert.deepEqual(
			parsePrefillQuery(
				'?utm_source=test&prefill[q_1]=Alice&prefill[q_3][]=31&prefill[q_3][]=32',
			),
			[
				{ key: 'q_1', values: ['Alice'] },
				{ key: 'q_3', values: ['31', '32'] },
			],
		)
	})

	it('decodes URL-encoded names and values', () => {
		assert.deepEqual(
			parsePrefillQuery(
				'?prefill%5Bn_%E7%94%B5%E5%AD%90%E9%82%AE%E7%AE%B1%5D=a%40example.com',
			),
			[{ key: 'n_电子邮箱', values: ['a@example.com'] }],
		)
	})

	it('parses positional order keys and repeated array values', () => {
		assert.deepEqual(parsePrefillQuery('?prefill[o_3][]=1&prefill[o_3][]=3'), [
			{ key: 'o_3', values: ['1', '3'] },
		])
	})
})

describe('question resolution', () => {
	it('resolves q_<id> exactly', () => {
		assert.equal(resolveQuestionById(questions, 'q_2')?.id, 2)
		assert.equal(resolveQuestionById(questions, 'q_999'), undefined)
	})

	it('resolves n_<text> to the first containing question', () => {
		assert.equal(resolveQuestionByName(questions, 'n_电子邮箱')?.id, 1)
		assert.equal(resolveQuestionByName(questions, 'n_ 备用电子 ')?.id, 2)
		assert.equal(resolveQuestionByName(questions, 'n_')?.id, undefined)
	})

	it('uses case-sensitive name matching', () => {
		const latinQuestions = [{ id: 10, text: 'Email Address', type: 'short' }]
		assert.equal(resolveQuestionByName(latinQuestions, 'n_Email')?.id, 10)
		assert.equal(resolveQuestionByName(latinQuestions, 'n_email'), undefined)
	})

	it('resolves strict one-based rendered question orders', () => {
		assert.equal(resolveQuestionByOrder(questions, 'o_1')?.id, 1)
		assert.equal(resolveQuestionByOrder(questions, 'o_10')?.id, 10)
		for (const key of ['o_0', 'o_01', 'o_-1', 'o_1.5', 'o_a', 'o_999']) {
			assert.equal(resolveQuestionByOrder(questions, key), undefined)
		}
	})
})

describe('normalizePrefillAnswers', () => {
	it('prefers q_<id> over an n_<text> alias for the same question', () => {
		assert.deepEqual(
			normalize('?prefill[n_电子邮箱]=alias&prefill[q_1]=stable').answers,
			{ 1: ['stable'] },
		)
	})

	it('uses q_<id>, o_<order>, n_<text> priority for the same question', () => {
		assert.deepEqual(
			normalize('?prefill[n_电子邮箱]=name&prefill[o_1]=order&prefill[q_1]=id')
				.answers,
			{ 1: ['id'] },
		)
	})

	it('falls back when a higher-priority value is invalid', () => {
		assert.deepEqual(
			normalize('?prefill[q_4]=999&prefill[o_4]=2&prefill[n_选择国家]=41')
				.answers,
			{ 4: ['42'] },
		)
		assert.deepEqual(
			normalize('?prefill[q_4]=999&prefill[o_4]=0&prefill[n_选择国家]=41')
				.answers,
			{ 4: ['41'] },
		)
	})

	it('uses the first successful name alias for a question', () => {
		assert.deepEqual(
			normalize('?prefill[n_电子邮箱]=first&prefill[n_请输入您的]=second')
				.answers,
			{ 1: ['first'] },
		)
	})

	it('normalizes text, multiple choice and dropdown answers', () => {
		assert.deepEqual(
			normalize(
				'?prefill[q_1]=Alice&prefill[q_3][]=31&prefill[q_3][]=32&prefill[q_4]=41',
			).answers,
			{
				1: ['Alice'],
				3: ['31', '32'],
				4: ['41'],
			},
		)
	})

	it('prefills text by rendered question order', () => {
		assert.deepEqual(normalize('?prefill[o_1]=Order Alice').answers, {
			1: ['Order Alice'],
		})
	})

	it('maps displayed option orders to stable IDs', () => {
		assert.deepEqual(
			normalize(
				'?prefill[o_3][]=3&prefill[o_3][]=1&prefill[o_4]=2&prefill[o_10]=1',
			).answers,
			{
				3: ['33', '31'],
				4: ['42'],
				10: ['101'],
			},
		)
	})

	it('deduplicates mapped multiple-choice orders in URL order', () => {
		assert.deepEqual(
			normalize('?prefill[o_3][]=2&prefill[o_3][]=2&prefill[o_3][]=1').answers,
			{ 3: ['32', '31'] },
		)
	})

	it('rejects every invalid option order without partial selection', () => {
		for (const value of ['0', '01', '-1', '1.5', 'a', '4']) {
			assert.deepEqual(
				normalize(`?prefill[o_3][]=1&prefill[o_3][]=${value}`).answers,
				{},
			)
		}
	})

	it('deduplicates multiple choice values in URL order', () => {
		assert.deepEqual(
			normalize('?prefill[q_3][]=32&prefill[q_3][]=32&prefill[q_3][]=31')
				.answers,
			{ 3: ['32', '31'] },
		)
	})

	it('rejects unknown options and multiple values for a dropdown', () => {
		assert.deepEqual(
			normalize('?prefill[q_3]=999&prefill[q_4][]=41&prefill[q_4][]=42')
				.answers,
			{},
		)
	})

	it('validates date ranges strictly', () => {
		assert.deepEqual(
			normalize('?prefill[q_5][]=2026-07-24&prefill[q_5][]=2026-07-31')
				.answers,
			{ 5: ['2026-07-24', '2026-07-31'] },
		)
		assert.deepEqual(
			normalize('?prefill[q_5][]=2026-07-31&prefill[q_5][]=2026-07-24')
				.answers,
			{},
		)
		assert.deepEqual(
			normalize('?prefill[q_5][]=2026-02-30&prefill[q_5][]=2026-03-01')
				.answers,
			{},
		)
	})

	it('validates linear scale bounds', () => {
		assert.deepEqual(normalize('?prefill[q_6]=10').answers, {
			6: ['10'],
		})
		assert.deepEqual(normalize('?prefill[q_6]=11').answers, {})
	})

	it('requires every ranking option exactly once', () => {
		assert.deepEqual(
			normalize('?prefill[q_7][]=73&prefill[q_7][]=71&prefill[q_7][]=72')
				.answers,
			{ 7: ['73', '71', '72'] },
		)
		assert.deepEqual(
			normalize('?prefill[q_7][]=73&prefill[q_7][]=71').answers,
			{},
		)
	})

	it('maps a complete positional ranking to stable IDs', () => {
		assert.deepEqual(
			normalize('?prefill[o_7][]=3&prefill[o_7][]=1&prefill[o_7][]=2').answers,
			{ 7: ['73', '71', '72'] },
		)
		for (const search of [
			'?prefill[o_7][]=3&prefill[o_7][]=1',
			'?prefill[o_7][]=3&prefill[o_7][]=1&prefill[o_7][]=1',
			'?prefill[o_7][]=3&prefill[o_7][]=1&prefill[o_7][]=4',
		]) {
			assert.deepEqual(normalize(search).answers, {})
		}
	})

	it('ignores positional option prefill when options are shuffled', () => {
		const shuffledQuestions = questions.map((question) =>
			question.id === 3
				? {
						...question,
						extraSettings: {
							...question.extraSettings,
							shuffleOptions: true,
						},
					}
				: question,
		)
		assert.deepEqual(normalize('?prefill[o_3]=1', shuffledQuestions).answers, {})
		assert.deepEqual(normalize('?prefill[q_3]=31', shuffledQuestions).answers, {
			3: ['31'],
		})
		assert.deepEqual(
			normalize('?prefill[n_选择水果]=31', shuffledQuestions).answers,
			{ 3: ['31'] },
		)
	})

	it('silently ignores file, grid, empty and overlong answers', () => {
		const overlong = 'x'.repeat(4097)
		assert.deepEqual(
			normalize(
				`?prefill[q_8]=file&prefill[q_9]=grid&prefill[q_1]=&prefill[q_2]=${overlong}`,
			).answers,
			{},
		)
	})

	it('reports whether any prefill parameters were supplied', () => {
		assert.equal(normalize('?other=value').hasPrefillParameters, false)
		assert.equal(normalize('?prefill[q_999]=value').hasPrefillParameters, true)
	})
})
