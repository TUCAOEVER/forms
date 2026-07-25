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
		options: [{ id: 31 }, { id: 32 }, { id: 33 }],
		extraSettings: { optionsLimitMin: 1, optionsLimitMax: 2 },
	},
	{
		id: 4,
		text: '选择国家',
		type: 'dropdown',
		options: [{ id: 41 }, { id: 42 }],
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
		options: [{ id: 71 }, { id: 72 }, { id: 73 }],
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
})

describe('normalizePrefillAnswers', () => {
	it('prefers q_<id> over an n_<text> alias for the same question', () => {
		assert.deepEqual(
			normalize('?prefill[n_电子邮箱]=alias&prefill[q_1]=stable').answers,
			{ 1: ['stable'] },
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
