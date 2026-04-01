$base = "http://localhost:3000"
$body = '{"email":"aziz@gmail.com","password":"Admin1234!"}'
try {
    $r = Invoke-WebRequest -Uri "$base/auth/login" -Method POST -ContentType "application/json" -Body [System.Text.Encoding]::UTF8.GetBytes($body) -UseBasicParsing
    Write-Host "SUCCESS:"
    Write-Host $r.Content
} catch {
    Write-Host "ERROR:"
    Write-Host $_.Exception.Response.StatusCode
    $sr = $_.Exception.Response.GetResponseStream()
    $rd = New-Object System.IO.StreamReader($sr)
    Write-Host $rd.ReadToEnd()
}
