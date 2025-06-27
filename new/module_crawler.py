# ----------------- 依赖库导入 -----------------
from bilibili_api import video, comment, sync
from bilibili_api import Credential as BiliCredential  # 从库导入的Credential

import csv
import datetime
import os
import json
import asyncio
import random
from dataclasses import dataclass

# ----------------- 自动加载最新凭证的模块 (无修改) -----------------

@dataclass
class CredentialData:
    """存储从JSON文件中读取的关键Cookie信息"""
    sessdata: str = ""
    bili_jct: str = ""
    buvid3: str = ""
    dedeuserid: str = ""
    ac_time_value: str = ""

def load_latest_credential(directory: str) -> CredentialData | None:
    """
    在指定目录中查找最新的 Bilibili 凭证文件并加载它。
    """
    print(f"正在扫描目录 '{directory}' 以查找最新的凭证文件...")
    
    if not os.path.isdir(directory):
        print(f"错误：凭证目录 '{directory}' 不存在。")
        return None

    try:
        credential_files = [
            f for f in os.listdir(directory) 
            if f.startswith("bilibili_credential_") and f.endswith(".json")
        ]
    except OSError as e:
        print(f"错误：无法读取目录 '{directory}'。原因: {e}")
        return None

    if not credential_files:
        print(f"错误：在目录 '{directory}' 中没有找到任何 'bilibili_credential_*.json' 文件。")
        return None

    credential_files.sort()
    latest_file_name = credential_files[-1]
    latest_file_path = os.path.join(directory, latest_file_name)

    print(f"已找到最新的凭证文件: '{latest_file_path}'")

    try:
        with open(latest_file_path, "r", encoding="utf-8") as f:
            cred_dict = json.load(f)
        
        credential_data = CredentialData(
            sessdata=cred_dict.get("sessdata", ""),
            bili_jct=cred_dict.get("bili_jct", ""),
            buvid3=cred_dict.get("buvid3", ""),
            dedeuserid=cred_dict.get("dedeuserid", ""),
            ac_time_value=cred_dict.get("ac_time_value", ""),
        )
        
        print("凭证加载成功！")
        return credential_data
        
    except (json.JSONDecodeError, KeyError) as e:
        print(f"错误：解析文件 '{latest_file_path}' 失败。请确保文件格式正确。原因: {e}")
        return None
    except OSError as e:
        print(f"错误：读取文件 '{latest_file_path}' 失败。原因: {e}")
        return None

# ----------------- 评论爬取主函数 (已修复) -----------------

def crawl_comments(bv_id, save_dir=None):
    """爬取指定BV号视频的评论，保存为CSV文件，返回CSV文件路径"""
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    credential_dir = os.path.join(current_dir, "bilibili_cookie_output")
    my_credential_data = load_latest_credential(credential_dir)
    
    if not my_credential_data:
        print("凭证加载失败，无法继续爬取评论。")
        return None
        
    credential = BiliCredential(
        sessdata=my_credential_data.sessdata,
        bili_jct=my_credential_data.bili_jct,
        buvid3=my_credential_data.buvid3,
        dedeuserid=my_credential_data.dedeuserid,
        ac_time_value=my_credential_data.ac_time_value,
    )

    v = video.Video(bvid=bv_id, credential=credential)

    async def get_all_sub_comments(oid, rpid):
        """异步获取一个根评论下的所有子评论（回复）。此函数逻辑正确，无需修改。"""
        sub_comments = []
        page_num = 1
        # 注意：子评论的API参数确实是 pn
        c_obj = comment.Comment(
            oid=oid, type_=comment.CommentResourceType.VIDEO, rpid=rpid, credential=credential
        )
        while True:
            try:
                sub_comment_data = await c_obj.get_sub_comments(page_index=page_num, page_size=10)
                
                if not sub_comment_data or not sub_comment_data.get("replies"):
                    break

                sub_comments.extend(sub_comment_data["replies"])

                if len(sub_comments) >= sub_comment_data['page']['count']:
                    break
                
                page_num += 1
                await asyncio.sleep(random.uniform(0.5, 1.0))

            except Exception as e:
                print(f"  [!] 获取 rpid={rpid} 的子评论时在第 {page_num} 页出错: {e}")
                break
        return sub_comments

    async def main():
        """主异步函数，采用手动分页方式爬取评论，确保稳定。"""
        comments_clustered = []
        print(f"\n开始爬取视频 {bv_id} 的评论...")
        page_num = 1
        
        try:
            video_aid = v.get_aid()
            print(f"视频AID获取成功: {video_aid}")

            while True:
                print(f"正在获取第 {page_num} 页主评论...")
                # --- 核心修复：主评论分页参数是 `page` 而不是 `pn` ---
                main_comments_page = await comment.get_comments(
                    oid=video_aid, 
                    type_=comment.CommentResourceType.VIDEO, 
                    page_index=page_num,
                    credential=credential
                )

                if not main_comments_page or not main_comments_page.get("replies"):
                    print("已获取所有主评论。")
                    break
                
                parent_comments = main_comments_page["replies"]
                
                for parent_comment in parent_comments:
                    print(f"  > 处理父评论 rpid: {parent_comment['rpid']} | 用户: {parent_comment['member']['uname']}")
                    comments_clustered.append(parent_comment)
                    
                    sub_comments = await get_all_sub_comments(video_aid, parent_comment["rpid"])
                    if sub_comments:
                        print(f"    -> 成功获取其 {len(sub_comments)} 条子评论。")
                        comments_clustered.extend(sub_comments)
                
                page_num += 1
                await asyncio.sleep(random.uniform(1.0, 2.5))

        except Exception as e:
            print(f"[!!] 在处理评论时发生严重错误: {e}")

        if not comments_clustered:
            print("未能获取到任何评论，程序终止。")
            return None

        info = await v.get_info()
        title = info["title"].replace("/", "-").replace("\\", "-")
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{title}_comments_{timestamp}.csv"
        
        save_dir_final = save_dir if save_dir else "./results"
        os.makedirs(save_dir_final, exist_ok=True)
        save_path = os.path.join(save_dir_final, filename)

        with open(save_path, "w", newline="", encoding="utf-8-sig") as csvfile:
            fieldnames = ["评论ID", "用户名", "评论内容", "点赞数", "回复时间", "父评论ID"]
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            for cmt in comments_clustered:
                writer.writerow({
                    "评论ID": cmt["rpid"],
                    "用户名": cmt["member"]["uname"],
                    "评论内容": cmt["content"]["message"],
                    "点赞数": cmt["like"],
                    "回复时间": datetime.datetime.fromtimestamp(cmt["ctime"]).strftime("%Y-%m-%d %H:%M:%S"),
                    "父评论ID": cmt.get("parent", 0),
                })
        
        print(f"\n爬取完成！评论已保存到文件：{save_path}")
        print(f"共爬取 {len(comments_clustered)} 条评论（包含父评论和子评论）。")
        return save_path

    return asyncio.run(main())


if __name__ == "__main__":
    # 请在这里输入你想要爬取的B站视频的BV号
    target_bv_id = "BV1AYKgzAE68" # 这是一个示例BV号，请替换
    save_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bilibili_csv_output")
    crawl_comments(target_bv_id, save_dir)
