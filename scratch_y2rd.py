import urllib.request
req = urllib.request.Request('https://y2rd.com/ar/500-%D9%85%D9%86%D8%AA%D8%AC%D8%A7%D8%AA-%D8%B9%D8%B4%D9%88%D8%A7%D8%A6%D9%8A%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D9%89-60-100/p1655100776', headers={'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'})
html = urllib.request.urlopen(req).read().decode('utf-8')
idx = html.find('class="sidebar')
print(html[idx-100:idx+400])
