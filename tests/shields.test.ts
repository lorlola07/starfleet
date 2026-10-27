import { expect, test } from 'claude-code/testing'
import { hostileReason } from '../hooks/shields'

test('shields catch destructive commands however they are written', async () => {
  const blocked = [
    // forced or precious recursive deletes
    'rm -rf build', 'rm -fr build', 'rm -r -f build', 'rm --recursive --force x', 'cd a && rm -Rf b',
    '\\rm -rf ~', 'r""m -rf ~', "'rm' -rf dist", '/bin/rm -rf x', 'rm -r ~', 'rm -r /', 'rm -R .', 'rm -r $HOME',
    // hidden inside other commands
    'bash -c "rm -rf ~"', "sh -lc 'rm -rf dist'", '(rm -rf build)', 'echo $(rm -rf x)', 'echo `rm -rf x`',
    'echo "$(rm -rf x)"', 'eval "rm -rf x"', 'x=rm; $x -rf ~', 'sudo rm -rf /var/x', 'env FOO=1 rm -rf x',
    'timeout 10 rm -rf x', 'find . -name "*.o" | xargs -0 rm -rf', 'nohup rm -rf x &',
    // find
    'find ~ -delete', 'find . -name x -exec rm {} +',
    // git
    'git push -f origin main', 'git push --force-with-lease', 'git push -uf origin x', 'git -C dir push --force',
    'git push origin +main', 'git push origin :main', 'git push --delete origin x', 'git push --mirror',
    'git reset --hard', 'git reset -q --hard', 'git reset HEAD --hard', 'git clean -fdx', 'git clean --force',
    'git checkout -f main', 'git checkout -- .', 'git restore .', 'git branch -D old', 'git -c alias.p=push p -f',
    'git -c "alias.nuke=!rm -rf x" nuke', 'git -calias.p=push p -f',
    // wrappers Shields doesn't list, and commands handed over as one string
    'caffeinate rm -rf x', 'stdbuf -oL rm -rf x', 'flock /tmp/lock rm -rf x', 'parallel rm -rf ::: a b',
    'ssh host rm -rf x', "ssh host 'git push -f'", 'watch "rm -rf x"', 'su -c "rm -rf x"', 'env -S "rm -rf x"',
    // ANSI-C quoting
    "$'\\x72\\x6d' -rf x", "$'rm' -rf x",
    // a here-document's body is judged whoever reads it: a wrapped shell, a pipe into one, or a file
    'bash <<EOF\nrm -rf x\nEOF', 'sudo bash <<EOF\nrm -rf x\nEOF', 'cat <<EOF | bash\nrm -rf x\nEOF',
    'cat <<EOF > notes.md\nrm -rf x\nEOF',
    // a stray quote in a here-document's body can't hide the command after its closing line
    "cat <<EOF\n'\nEOF\nrm -rf x\n'", 'cat <<EOF\n"\nEOF\ngit reset --hard\n"',
  ]
  for (const command of blocked) expect([command, hostileReason(command)]).toEqual([command, expect.any(String)])
})

test('shields let ordinary commands through, even ones that mention danger', async () => {
  const allowed = [
    'rm -r build', 'rm -f a.txt', 'rm a b c', 'ls -rf', 'grep -rf patterns.txt src',
    'echo rm -rf x', 'echo "git push -f"', 'git commit -m "never git push -f or rm -rf"', 'printf "git reset --hard\\n"',
    'git push origin main', 'git push -u origin feature', 'git reset HEAD~1', 'git reset --soft HEAD~1',
    'git clean -n', 'git checkout -b feature', 'git checkout main', 'git restore src/a.ts', 'git branch -d merged',
    'npm test 2>&1 | tail -5', 'find . -name "*.ts"', 'cat notes.md # rm -rf x', 'bash scripts/build.sh',
    'cat <<EOF > notes.md\nhello\nEOF', 'npm run build\nnpm test', 'git commit -m "Fix the band\n\nIt now shows other plugins"',
    'gh pr create --body "rm -rf is dangerous"', 'npm run build', 'node -e "console.log(1)"', 'ssh host ls',
  ]
  // What follows a here-document is judged too
  expect(hostileReason('cat <<EOF > a.md\nhello\nEOF\ngit reset --hard')).toBe('git reset --hard')
  for (const command of allowed) expect([command, hostileReason(command)]).toEqual([command, undefined])
})
