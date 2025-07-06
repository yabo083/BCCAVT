from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager
import json
import time
from dataclasses import dataclass, asdict
import os
import datetime

# 使用 dataclass 来定义凭证的数据结构，更规范
@dataclass
class Credential:
    """存储B站请求所需的关键Cookie信息"""
    sessdata: str = ""
    bili_jct: str = ""
    buvid3: str = ""
    dedeuserid: str = ""
    ac_time_value: str = ""

def get_bilibili_credential(cookie_output_file: str) -> Credential | None:
    """
    通过 Selenium 自动打开B站并由用户手动登录，以获取并提取关键Cookie。

    Args:
        cookie_output_file (str): 保存完整Cookie的JSON文件的完整路径。

    Returns:
        Credential | None: 如果成功获取，则返回一个包含关键Cookie的Credential对象；否则返回None。
    """
    # 使用 webdriver-manager 自动管理 ChromeDriver
    options = webdriver.ChromeOptions()
    # 你可以在这里添加其他选项，例如 --headless（无头模式），但登录需要图形界面
    service = ChromeService(executable_path=ChromeDriverManager().install())
    browser = webdriver.Chrome(service=service, options=options)

    try:
        # 1. 打开B站首页
        browser.get("https://www.bilibili.com")
        print("浏览器已打开，正在访问B站首页...")

        # 2. 清空已有Cookie，确保获取新登录的Cookie
        browser.delete_all_cookies()
        print("已清除所有旧的Cookie。")
        time.sleep(2) # 等待页面响应

        # 3. 提示用户手动登录
        print("\n" + "="*50)
        input("请在弹出的浏览器窗口中手动完成登录，然后回到这里按【回车键】继续...")
        print("="*50 + "\n")
        
        print("正在获取登录后的Cookie...")
        # 4. 获取登录后的所有Cookie
        cookies_list = browser.get_cookies()

        if not cookies_list:
            print("错误：未能获取到任何Cookie，请确保您已成功登录。")
            return None

        # 5. (可选但推荐) 将完整的Cookie保存到JSON文件，以备后用
        with open(cookie_output_file, 'w', encoding='utf-8') as f:
            json.dump(cookies_list, f, ensure_ascii=False, indent=4)
        print(f"完整的Cookie信息已成功保存到文件: {cookie_output_file}")

        # 6. 直接在内存中处理Cookie，提取所需凭证
        # 将Cookie列表转换为字典以便快速查找
        cookie_dict = {c['name']: c['value'] for c in cookies_list}

        # 检查关键的登录凭证是否存在
        if "SESSDATA" not in cookie_dict or "bili_jct" not in cookie_dict:
            print("错误：获取的Cookie中缺少关键的 SESSDATA 或 bili_jct 字段。")
            print("请确认您是否已成功登录B站。")
            return None

        # 7. 创建 Credential 对象
        credential = Credential(
            sessdata=cookie_dict.get("SESSDATA", ""),
            bili_jct=cookie_dict.get("bili_jct", ""),
            buvid3=cookie_dict.get("buvid3", ""),
            # 注意: DedeUserID 的 'D' 可能是大写，需要确认
            dedeuserid=cookie_dict.get("DedeUserID", ""),
            ac_time_value=cookie_dict.get("ac_time_value", ""),
        )
        
        print("成功提取到关键凭证！")
        return credential

    except Exception as e:
        print(f"在执行过程中发生错误: {e}")
        return None
    finally:
        # 8. 无论成功与否，最后都关闭浏览器
        print("正在关闭浏览器...")
        browser.quit()


if __name__ == "__main__":
    # --- 调用主函数 ---

    
    # 0. 获取当前文件的目录
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # 1. 定义一个统一的输出文件夹名称
    output_dir = "bilibili_cookie_output"
    
    # 2. 在写入前，确保这个文件夹存在。如果不存在，os.makedirs会创建它。
    # exist_ok=True 表示如果文件夹已经存在，不要报错。
    os.makedirs(os.path.join(current_dir, output_dir), exist_ok=True)
    print(f"所有文件将被保存在 '{output_dir}' 文件夹中。")
    
    # 获取当前时间戳，用于生成独一无二的文件名
    now_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 3. 使用 os.path.join() 来安全地构建跨平台的文件路径
    full_cookies_file = os.path.join(current_dir, output_dir, f"bilibili_cookies_full_{now_str}.json")
    credential_file = os.path.join(current_dir, output_dir, f"bilibili_credential_{now_str}.json")


    bili_credential = get_bilibili_credential(cookie_output_file=full_cookies_file)

    # 如果成功获取到了Credential对象，就将其保存到文件中
    if bili_credential:
        print(f"\n--- 正在将关键凭证信息保存到文件: {credential_file} ---")
        try:
            # asdict可以将dataclass实例转换为字典
            credential_dict = asdict(bili_credential)
            
            # 将凭证字典保存到指定的JSON文件
            with open(credential_file, 'w', encoding='utf-8') as f:
                json.dump(credential_dict, f, ensure_ascii=False, indent=4)
            
            print(f"关键凭证已成功保存！")
            print("\n文件内容预览:")
            print(json.dumps(credential_dict, indent=4, ensure_ascii=False))

        except Exception as e:
            print(f"保存凭证文件 {credential_file} 时出错: {e}")
            
    else:
        print("\n获取B站凭证失败，将不会生成凭证文件。")
