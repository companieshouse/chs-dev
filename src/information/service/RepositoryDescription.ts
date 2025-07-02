import { execa } from 'execa';

/**
 * Fetches the GitHub repository description using the gh CLI.
 * @param repo
 * @returns returned as a string, the description of the repo
 */
export async function getRepoDescription(repo: string): Promise<string> {
    try {
        const { stdout } = await execa('gh', [
            'repo',
            'view',
            '--json',
            'description',
            repo
        ]);
        
        const parsed = JSON.parse(stdout);
        return parsed.description ?? 'No description available.';
    } catch (error) {
        console.error(`Failed to fetch description for ${repo}:`, error);
        return 'Error fetching description.';
    }
}
