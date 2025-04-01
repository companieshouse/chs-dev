import { Octokit } from "octokit";
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

interface Repository {
    name: string;
    url: string;
    primaryLanguage: { name: string } | null;
    isArchived: boolean;
    isPrivate: boolean;
    description: string;
}

interface RepoStats {
    lang: string;
    name: string;
    lastCommitDate: Date | null;
    archived: string;
    averageCommitPerWeek: number;
    owner: string;
    private: string;
    description: string;
}

interface List {
    lang: string;
    count: number;
}

export default class Stats {
    private octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
    });
    private list: List[] = [];
    async waitForRateLimitReset(): Promise<void> {
        const rateLimit = await this.octokit.rest.rateLimit.get();
        const coreRateLimit = rateLimit.data.resources.core;
        if (coreRateLimit.remaining === 0) {
            const resetTime = new Date(coreRateLimit.reset * 1000);
            const waitTime = resetTime.getTime() - new Date().getTime();
            console.log(`Rate limit exceeded. Waiting for ${waitTime / 1000} seconds.`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    async getLastCommitDate(repoName: string): Promise<Date | null> {
        try {
            await this.waitForRateLimitReset();
            const response = await this.octokit.graphql<{
                repository: {
                    defaultBranchRef: {
                        target: {
                            committedDate: string;
                        };
                    };
                };
            }>(`
                query($org: String!, $repo: String!) {
                    repository(owner: $org, name: $repo) {
                        defaultBranchRef {
                            target {
                                ... on Commit {
                                    committedDate
                                }
                            }
                        }
                    }
                }
            `, {
                org: "companieshouse",
                repo: repoName,
            });
            const commitDate = response.repository.defaultBranchRef?.target?.committedDate;
            return commitDate ? new Date(commitDate) : null;
        } catch (error) {
            console.log(error);
            return null;
        }
    }

    async readDataFromFile(): Promise<RepoStats[]> {
        try {
            const fileContent = await fs.promises.readFile('./local/repositoryRawData.json', 'utf8');
            const data: RepoStats[] = JSON.parse(fileContent);
            data.forEach(repo => {
                if (repo.lastCommitDate) {
                    repo.lastCommitDate = new Date(repo.lastCommitDate);
                }
            });
            return data;
        } catch (error) {
            return [];
        }
    }

    async getAllRepos(org: string): Promise<Repository[]> {
        let repositories: Repository[] = [];
        let hasNextPage = true;
        let endCursor: string | null = null;

        while (hasNextPage) {
            const response = await this.octokit.graphql<{
                organization: {
                    repositories: {
                        pageInfo: {
                            hasNextPage: boolean;
                            endCursor: string | null;
                        };
                        nodes: Repository[];
                    };
                };
            }>(`
                query($org: String!, $cursor: String) {
                    organization(login: $org) {
                        repositories(first: 100, after: $cursor) {
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                            nodes {
                                name
                                url
                                primaryLanguage {
                                    name
                                }
                                isArchived
                                description
                                isPrivate
                            }
                        }
                    }
                }
            `, { org, cursor: endCursor });
            repositories = repositories.concat(response.organization.repositories.nodes);
            hasNextPage = response.organization.repositories.pageInfo.hasNextPage;
            endCursor = response.organization.repositories.pageInfo.endCursor;
        }

        return repositories;
    }

    async getAverageCommitsPerWeek(org: string, repoName: string): Promise<number> {
        const owner = org;
        const repo = repoName;
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                await this.waitForRateLimitReset();
                const response = await this.octokit.rest.repos.getCommitActivityStats({
                    owner,
                    repo,
                });

                if (response.data && response.data.length > 0) {
                    const totalCommits = response.data.reduce((sum, week) => sum + week.total, 0);
                    const numberOfWeeks = response.data.length;
                    const averageCommitsPerWeek = totalCommits / numberOfWeeks;
                    return parseFloat(averageCommitsPerWeek.toFixed(3));
                } else if (response.status === 202) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.log(error);
            }
        }
        return 0;
    }

    async getRepositoryOwner(repoName: string): Promise<string> {
        const owner = "companieshouse";
        const path = "CODEOWNERS";
        const repo = repoName;
        const pattern = /@[\w\d\.-]+\/([\w\d.-]+)/
        let repositoryOwner = 'NOT SET';

        try{
            const response = await this.octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                mediaType:{
                    format: 'raw',
                },
            });

            let lines: string[] = [];
            if (typeof response.data === 'string') {
                lines = (response.data as string).split('\n');
            }
            lines.forEach((line, index) => {
                if (line.startsWith("*")){
                const matches  = line.match(pattern);
                    if (matches){
                        repositoryOwner = matches[1];
                    }
                }
            });
        }catch(error){
            if ((error as any).response && (error as any).response.status !== 404){
                console.log(error)
            }
        }
        return repositoryOwner;
    }

    async processRepository(repo: Repository): Promise<RepoStats> {
        const lastCommitDate = await this.getLastCommitDate(repo.name);
        const language = repo.primaryLanguage ? repo.primaryLanguage.name : "NotSet";
        let averageCommit = 0; // Default to 0
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        if (lastCommitDate && lastCommitDate > oneYearAgo) {
            averageCommit = await this.getAverageCommitsPerWeek("companieshouse", repo.name);
        }

        const repositoryOwner = await this.getRepositoryOwner(repo.name);
        return {
            lang: language,
            name: repo.name,
            lastCommitDate: lastCommitDate,
            archived: repo.isArchived ? "Archived" : "",
            averageCommitPerWeek: averageCommit,
            owner: repositoryOwner,
            private: repo.isPrivate ? "Private" : "",
            description: repo.description
        };
    }

    async saveDataToFile(data: RepoStats[], filePath: string): Promise<void> {
        const tempFilePath = `${filePath}.tmp`;
        try {
            await fs.promises.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf8');
            await fs.promises.rename(tempFilePath, filePath);
            console.log(`Data successfully saved to ${filePath}`);
        } catch (error) {
            console.error(`Error saving data to ${filePath}:`, error);
        }
    }

    createMarkdownWithRepoStats(data: RepoStats[]): string {
        const headerMapping = {
            lang: 'Language',
            name: 'Repository Name',
            lastCommitDate: 'Last Commit Date',
            isArchived: 'Archived',
            averageCommitPerWeek: 'Average Commits/Week',
            owner: 'Owner'
        };

        const headers = Object.keys(data[0]) as (keyof RepoStats)[];
        const headerRow = `| ${headers.map(header => headerMapping[header] || header).join(' | ')} |`;
        const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
        const dataRows = data.map(row => {
            return `| ${headers.map(header => {
                let value = row[header];
                if (value instanceof Date) {
                    const date = value.toLocaleDateString('en-GB');
                    const time = value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    value = `${date} ${time}`;
                }
                return value !== null && value !== undefined ? value : '';
            }).join(' | ')} |`;
        });

        return [headerRow, separatorRow, ...dataRows].join('\n');
    }

    createMarkdownWithLanguagesUsed(data: List[], archiveRepoCount: number, oldReposCount: number, prototypeCount: number): string {
        const headerMapping = {
            lang: 'Language',
            name: 'Repository Name',
            lastCommitDate: 'Last Commit Date',
            isArchived: 'Archived',
            averageCommitPerWeek: 'Average Commits/Week',
            owner: 'Owner'
        };

        const headers = Object.keys(data[0]) as (keyof RepoStats)[];
        const headerRow = `| ${headers.map(header => headerMapping[header] || header).join(' | ')} |`;
        const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
        const dataRows = data.map(row => {
            return `| ${headers.map(header => {
                let value = row[header];
                if (value instanceof Date) {
                    const date = value.toLocaleDateString('en-GB');
                    const time = value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    value = `${date} ${time}`;
                }
                return value !== null && value !== undefined ? value : '';
            }).join(' | ')} |`;
        });

        return [headerRow, separatorRow, ...dataRows].join('\n');
    }

    async generateReport(): Promise<void> {
        let repositoryRawData = await this.readDataFromFile();
        if (repositoryRawData.length === 0) {
            const totalRepos = await this.getAllRepos("companieshouse");
            const repoPromises = totalRepos.map((repo, index) => {
                console.log(`processing ${index + 1}/${totalRepos.length} repositories`);
                return this.processRepository(repo);
            });
            repositoryRawData = await Promise.all(repoPromises);
            await this.saveDataToFile(repositoryRawData, './local/repositoryRawData.json');
        }

        repositoryRawData.sort((a, b) => {
            const dateA = a.lastCommitDate ? new Date(a.lastCommitDate) : new Date(0);
            const dateB = b.lastCommitDate ? new Date(b.lastCommitDate) : new Date(0);
            if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
                console.log(`Invalid date found: ${a.name} (${a.lastCommitDate}), ${b.name} (${b.lastCommitDate})`);
            }
            return dateB.getTime() - dateA.getTime();
        });

        let archiveRepoCount = 0;
        let oldReposCount = 0;
        let prototypeCount = 0;

        const dateThreshold = new Date();
        dateThreshold.setFullYear(dateThreshold.getFullYear() - 4);
        let potentialReposToRemove: string[] = [];
        for (const repo of repositoryRawData) {
            let found = this.list.find(item => typeof item.lang != 'undefined' && repo.lang != null && item.lang === repo.lang);
            const foundIndex = this.list.findIndex(item => typeof item.lang != 'undefined' && repo.lang != null && item.lang === repo.lang);
            if (found) {
                found.count++;
            } else {
                let language = repo.lang || "NotSet";
                this.list.push({ lang: language, count: 1 });
            }

            if (repo.archived) {
                archiveRepoCount++;
                potentialReposToRemove.push(repo.name)
            }

            if (repo.lastCommitDate && new Date(repo.lastCommitDate) < dateThreshold) {
                oldReposCount++;
                potentialReposToRemove.push(repo.name)
            }

            if (repo.name.toLowerCase().includes("prototype") ) {
                prototypeCount++;
                potentialReposToRemove.push(repo.name)
            }
        }

        const unique = Array.from(new Set(potentialReposToRemove));

        this.list.sort((a, b) => a.lang.toLowerCase().localeCompare(b.lang.toLowerCase()))

        let repositoryStatisticsMarkdown = this.createMarkdownWithLanguagesUsed(this.list, archiveRepoCount, oldReposCount, prototypeCount);
        repositoryStatisticsMarkdown =  `* Total Number of Repositories: ${repositoryRawData.length} \n`+
                        `* Archived Repositories: ${archiveRepoCount}\n` +
                        `* Repositories not touched in 4 years: ${oldReposCount}\n` +
                        `* Prototype Repositories: ${prototypeCount}\n\n` + repositoryStatisticsMarkdown + '\n\n' +
                        `Potential number of repos to remove: ${unique.length} \n` +
                        `Potential repos to remove: \n  * ${unique.join('\n   * ')} \n\n`;
        const repositoryInformationMarkdown = this.createMarkdownWithRepoStats(repositoryRawData);


        repositoryStatisticsMarkdown =  `* Total Number of Repositories: ${repositoryRawData.length} \n`+
                                        `* Potential number of repos to remove: ${unique.length} (Archived : ${archiveRepoCount}, not edits in 4 years: ${oldReposCount}, Prototypes: ${prototypeCount}) \n` +
                        `Potential repos to remove: \n  * ${unique.join('\n   * ')} \n\n`;

        fs.writeFileSync('./local/repositoryStatistics.md', repositoryStatisticsMarkdown, 'utf8');
        fs.writeFileSync('./local/repositoryInformation.md', repositoryInformationMarkdown, 'utf8');

        console.log('list.md Markdown file have been saved to ./local');
        console.log('repositoryInformation.md Markdown file have been saved to ./local');
    }
}
