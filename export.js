const mysql = require('mysql');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { Octokit } = require("@octokit/rest");
const schedule = require('node-schedule');
const fs = require('fs');

// 配置数据库连接
const dbConfig = {
    host: '127.0.0.1:3306',
    user: '数据库用户名',
    password: '数据库密码',
    database: '数据库名称'
};

// 配置GitHub
const githubConfig = {
    owner: 'sypai-cc', // 组织名称
    repo: 'all-posts',
    token: '个人GitHub令牌',
    path: './file.csv'
};

// 定时任务配置
const scheduleConfig = '0 * * * *'; // 每小时

// 创建数据库连接
const connection = mysql.createConnection(dbConfig);

// 创建Octokit实例
const octokit = new Octokit({
    auth: githubConfig.token
});

// 查询WordPress文章数据
function fetchPosts(callback) {
    const query = `
        SELECT p.ID, p.post_title, p.post_date, u.display_name, 
               GROUP_CONCAT(DISTINCT t.name) as tags, 
               GROUP_CONCAT(DISTINCT c.name) as categories
        FROM wp_posts p
        LEFT JOIN wp_users u ON p.post_author = u.ID
        LEFT JOIN wp_term_relationships tr ON p.ID = tr.object_id
        LEFT JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
        LEFT JOIN wp_terms t ON tt.term_id = t.term_id AND tt.taxonomy = 'post_tag'
        LEFT JOIN wp_terms c ON tt.term_id = c.term_id AND tt.taxonomy = 'category'
        WHERE p.post_type = 'post' AND p.post_status = 'publish'
        GROUP BY p.ID
        ORDER BY p.post_date DESC
    `;
    connection.query(query, callback);
}

// 导出数据到CSV
function exportToCsv(posts, callback) {
    const csvWriter = createCsvWriter({
        path: 'posts.csv',
        header: [
            { id: 'ID', title: 'ID' },
            { id: 'post_title', title: 'Title' },
            { id: 'post_date', title: 'Date' },
            { id: 'display_name', title: 'Author' },
            { id: 'tags', title: 'Tags' },
            { id: 'categories', title: 'Categories' }
        ]
    });

    csvWriter.writeRecords(posts)
        .then(() => {
            console.log('CSV file was written successfully');
            callback();
        });
}

// 获取文件的SHA值
async function getFileSha() {
    try {
        const { data } = await octokit.repos.getContent({
            owner: githubConfig.owner,
            repo: githubConfig.repo,
            path: githubConfig.path
        });
        return data.sha;
    } catch (error) {
        if (error.status === 404) {
            return null; // 文件不存在
        } else {
            throw error;
        }
    }
}

// 上传文件到GitHub
async function uploadToGitHub() {
    const content = fs.readFileSync('posts.csv', 'utf8');
    const base64Content = Buffer.from(content).toString('base64');
    const sha = await getFileSha();

    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: githubConfig.owner,
            repo: githubConfig.repo,
            path: githubConfig.path,
            message: 'Automated export of WordPress posts',
            content: base64Content,
            sha: sha, // 如果文件存在，则提供SHA值以覆盖
            committer: {
                name: "Your Name",
                email: "your-email@example.com"
            },
            author: {
                name: "Your Name",
                email: "your-email@example.com"
            }
        });
        console.log('File uploaded to GitHub successfully');
    } catch (error) {
        console.error('Error uploading file to GitHub:', error);
    }
}

// 主函数
function main() {
    fetchPosts((error, results) => {
        if (error) {
            console.error('Error fetching posts:', error);
            return;
        }

        exportToCsv(results, () => {
            uploadToGitHub();
        });
    });
}

// 设置定时任务
schedule.scheduleJob(scheduleConfig, main);

// 立即执行一次
main();
