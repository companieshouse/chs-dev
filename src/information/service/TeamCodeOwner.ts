import { execa } from 'execa';

/**
  * Fetches the repository code_owner using the gh CLI.
 * @param repo 
 * @returns team-code-owner value
 */
export async function getTeamCodeOwner(repo: string): Promise<string> {
    try {
        const { stdout } = await execa('gh', [
            'api',
            `/repos/${repo}`,
            '--jq',
            '.custom_properties["team-code-owner"]'
        ]);

        return stdout || 'Unknown code owner.';
    } catch (error) {
        console.error(`Failed to fetch team code owner for ${repo}:`, error);
        return 'Error fetching team code owner.';
    }
}
