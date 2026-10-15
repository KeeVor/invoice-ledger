"""Generate fictional invoice fixtures; never read the user's invoice files."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
root = Path('.test-data/synthetic-samples').resolve()
root.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 32)
title = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 48)
for number, day, item, amount, tax, total, name in [
    ('20000000000000000001', '07', '*生产生活服务*物业管理费', '12273.10', '736.39', '13009.49', 'pdf'),
    ('20000000000000000101', '11', '*食品*测试鸡蛋', '43411.70', '***', '43411.70', 'image'),
]:
    image = Image.new('RGB', (1800, 1100), 'white')
    draw = ImageDraw.Draw(image)
    draw.text((450, 50), '电子发票（普通发票）', fill='black', font=title)
    draw.text((80, 135), '虚构测试样例，不可用于报销', fill='black', font=font)
    draw.text((1000, 135), f'发票号码：{number}', fill='black', font=font)
    draw.text((1050, 200), f'开票日期：2026年09月{day}日', fill='black', font=font)
    draw.text((80, 310), '名称：虚构购买公司', fill='black', font=font)
    draw.text((1000, 310), '名称：虚构销售公司', fill='black', font=font)
    draw.text((80, 480), '项目名称', fill='black', font=font)
    draw.text((80, 560), item, fill='black', font=font)
    if tax == '***':
        draw.text((1500, 560), '免税', fill='black', font=font)
    draw.text((80, 800), '合计', fill='black', font=font)
    draw.text((1100, 800), f'￥{amount}', fill='black', font=font)
    draw.text((1530, 800), f'￥{tax}' if tax != '***' else '***', fill='black', font=font)
    draw.text((80, 900), f'价税合计（小写）￥{total}', fill='black', font=font)
    if name == 'pdf':
        image.save(root / 'invoice.pdf', 'PDF', resolution=120)
    else:
        image.save(root / 'invoice.png')
    image.close()
print(root)
