// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
// `title` and `sidebar` are filled in by the migration engine (convert.mjs).
export default defineConfig({
	integrations: [
		starlight({
			title: 'BearQ',
			sidebar: [
				{ label: 'Overview', slug: 'overview' },
				{ label: 'Getting Started with BearQ', slug: 'getting-started-with-bearq' },
				{
					label: 'BearQ Agents',
					items: [
					{ label: 'Overview', slug: 'bearq-agents' },
					{ label: 'QA (Quality Assurance) Lead', slug: 'bearq-agents/qa-quality-assurance-lead' },
					{ label: 'Tester', slug: 'bearq-agents/tester' },
					{
						label: 'Explorer',
						items: [
						{ label: 'Overview', slug: 'bearq-agents/explorer' },
						{ label: 'Using the Explorer Agent', slug: 'bearq-agents/explorer/using-the-explorer-agent' }
						],
					}
					],
				},
				{
					label: 'External Agents',
					items: [
					{ label: 'Overview', slug: 'external-agents' },
					{ label: 'Connecting and Removing an External Agent', slug: 'external-agents/connecting-and-removing-an-external-agent' }
					],
				},
				{ label: 'Dashboard', slug: 'dashboard' },
				{
					label: 'Tests',
					items: [
					{ label: 'Overview', slug: 'tests' },
					{ label: 'Creating Tests', slug: 'tests/creating-tests' },
					{ label: 'Running Tests', slug: 'tests/running-tests' },
					{ label: 'Running Tests by Environment', slug: 'tests/running-tests-by-environment' },
					{ label: 'Running Tests By Tag', slug: 'tests/running-tests-by-tag' },
					{ label: 'Editing a Test', slug: 'tests/editing-a-test' },
					{ label: 'Reviewing and Fixing Tests', slug: 'tests/reviewing-and-fixing-tests' },
					{ label: 'Test Status', slug: 'tests/test-status' }
					],
				},
				{
					label: 'Issues',
					items: [
					{ label: 'Overview', slug: 'issues' },
					{ label: 'Finding and Viewing Issues', slug: 'issues/finding-and-viewing-issues' }
					],
				},
				{
					label: 'Reports',
					items: [
					{ label: 'Overview', slug: 'reports' },
					{ label: 'Summary', slug: 'reports/summary' },
					{ label: 'Deep Research', slug: 'reports/deep-research' },
					{ label: 'Generating a Report for a Specified Time', slug: 'reports/generating-a-report-for-a-specified-time' }
					],
				},
				{ label: 'Work', slug: 'work' },
				{
					label: 'Managing Settings',
					items: [
					{ label: 'Overview', slug: 'managing-settings' },
					{ label: 'Environment and Workspace', slug: 'managing-settings/environment-and-workspace' },
					{ label: 'Multiple Environments', slug: 'managing-settings/multiple-environments' },
					{ label: 'Managing Team', slug: 'managing-settings/managing-team' },
					{ label: 'Managing Workspaces', slug: 'managing-settings/managing-workspaces' }
					],
				},
				{ label: 'Context', slug: 'context' },
				{
					label: 'Application',
					items: [
					{ label: 'Overview', slug: 'application' },
					{ label: 'Application Model', slug: 'application/application-model' },
					{ label: 'Functional Areas in Application Model', slug: 'application/functional-areas-in-application-model' },
					{ label: 'API Endpoints', slug: 'application/api-endpoints' },
					{ label: 'API Tests and Viewing API Tests', slug: 'application/api-tests-and-viewing-api-tests' },
					{ label: 'Endpoint Discovery and Coverage', slug: 'application/endpoint-discovery-and-coverage' },
					{ label: 'Page Tests', slug: 'application/page-tests' },
					{ label: 'Creating and Refining Page Test', slug: 'application/creating-and-refining-page-test' }
					],
				},
				{
					label: 'Integrating BearQ with Jira',
					items: [
					{ label: 'Overview', slug: 'integrating-bearq-with-jira' },
					{ label: 'Work with the BearQ Agent in Jira', slug: 'integrating-bearq-with-jira/work-with-the-bearq-agent-in-jira' }
					],
				},
				{ label: 'Agent Compute Unit (ACU)', slug: 'agent-compute-unit-acu' },
				{ label: 'BearQ API', slug: 'bearq-api' },
				{
					label: 'Release Notes',
					items: [
					{ label: 'Overview', slug: 'release-notes' },
					{ label: 'Release Notes - August 2026', slug: 'release-notes/release-notes-august-2026' },
					{ label: 'Release Notes - July 2026', slug: 'release-notes/release-notes-july-2026' },
					{ label: 'Release Notes - June 2026', slug: 'release-notes/release-notes-june-2026' },
					{ label: 'Release Notes - May 2026', slug: 'release-notes/release-notes-may-2026' }
					],
				}
			],
		}),
	],
});
