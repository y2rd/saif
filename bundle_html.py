import os
import re
import subprocess
import sys

def build_and_pack():
    print("=" * 60)
    print("🚀 بدء بناء وتجميع المتجر في ملف HTML واحد متكامل...")
    print("=" * 60)

    project_dir = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(project_dir, 'dist')
    assets_dir = os.path.join(dist_dir, 'assets')
    dist_index = os.path.join(dist_dir, 'index.html')
    output_single_html = os.path.join(project_dir, 'store_standalone.html')

    # 1. تشغيل npm run build
    print("\n📦 الخطوة 1: تشغيل أمر البناء (npm run build)...")
    res = subprocess.run('npm run build', shell=True, cwd=project_dir)
    if res.returncode != 0:
        print("❌ فشل أمر البناء!")
        sys.exit(1)

    if not os.path.exists(dist_index):
        print(f"❌ لم يتم العثور على {dist_index}")
        sys.exit(1)

    print("\n🔍 الخطوة 2: قراءة وتجميع ملفات JavaScript و CSS المدمجة...")
    with open(dist_index, 'r', encoding='utf-8') as f:
        html_content = f.read()

    # البحث عن ملفات CSS في مجلد assets ودمجها
    css_files = [f for f in os.listdir(assets_dir) if f.endswith('.css')]
    combined_css = ""
    for css_file in css_files:
        css_path = os.path.join(assets_dir, css_file)
        with open(css_path, 'r', encoding='utf-8') as cf:
            combined_css += f"\n/* {css_file} */\n" + cf.read()

    # البحث عن ملفات JS في مجلد assets ودمجها
    js_files = [f for f in os.listdir(assets_dir) if f.endswith('.js')]
    combined_js = ""
    for js_file in js_files:
        js_path = os.path.join(assets_dir, js_file)
        with open(js_path, 'r', encoding='utf-8') as jf:
            combined_js += f"\n// {js_file}\n" + jf.read()

    # 3. إزالة الروابط الخارجية للـ assets من الـ HTML
    # إزالة <link rel="stylesheet" ... href="/assets/...">
    html_content = re.sub(r'<link[^>]+href=["\'][^"\']*assets/[^"\']+\.css["\'][^>]*>', '', html_content)
    # إزالة <script ... src="/assets/...">
    html_content = re.sub(r'<script[^>]+src=["\'][^"\']*assets/[^"\']+\.js["\'][^>]*>\s*</script>', '', html_content)

    # 4. حقن الـ CSS داخل <head>
    style_tag = f"<style>\n{combined_css}\n</style>\n"
    if "</head>" in html_content:
        html_content = html_content.replace("</head>", f"{style_tag}</head>")
    else:
        html_content += style_tag

    # 5. حقن الـ JS قبل نهاية </body>
    script_tag = f"<script type=\"module\">\n{combined_js}\n</script>\n"
    if "</body>" in html_content:
        html_content = html_content.replace("</body>", f"{script_tag}</body>")
    else:
        html_content += script_tag

    # 6. حفظ الملف الموحد
    with open(output_single_html, 'w', encoding='utf-8') as out_f:
        out_f.write(html_content)

    # أيضاً حفظ نسخة باسم index_single.html داخل dist
    dist_single = os.path.join(dist_dir, 'index_single.html')
    with open(dist_single, 'w', encoding='utf-8') as out_d:
        out_d.write(html_content)

    size_kb = os.path.getsize(output_single_html) / 1024
    print("\n" + "=" * 60)
    print("✅ تم إنشاء ملف الـ HTML بنجاح تام!")
    print(f"📄 اسم الملف: {os.path.basename(output_single_html)}")
    print(f"📍 المسار: {output_single_html}")
    print(f"📊 حجم الملف: {size_kb:.2f} KB")
    print("💡 يمكنك الآن فتح هذا الملف في أي متصفح أو رفعه كملف واحد لأي استضافة!")
    print("=" * 60)

if __name__ == '__main__':
    build_and_pack()
