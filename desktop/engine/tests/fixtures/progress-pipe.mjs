console.log(JSON.stringify({ event: 'downloading_forge' }));
const text = JSON.stringify({ event: 'download_progress', target: 'forge', bytes: 123, totalBytes: 256 });
process.stdout.write(text.slice(0, 13));
await new Promise(r => setTimeout(r, 10));
process.stdout.write(text.slice(13) + '\r\n');
