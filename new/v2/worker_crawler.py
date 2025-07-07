# ----------------- 依赖库导入 -----------------
from bilibili_api import video, comment, sync
from bilibili_api import Credential as BiliCredential

import datetime
import os
import json
import asyncio
import random
import re
from dataclasses import dataclass
from typing import Optional, Dict, List, Any


@dataclass
class CredentialData:
    """存储从JSON文件中读取的关键Cookie信息"""

    sessdata: str = ""
    bili_jct: str = ""
    buvid3: str = ""
    dedeuserid: str = ""
    ac_time_value: str = ""


def load_latest_credential(directory: str) -> Optional[CredentialData]:
    """
    在指定目录中查找最新的 Bilibili 凭证文件并加载它。
    """
    print(f"正在扫描目录 '{directory}' 以查找最新的凭证文件...")

    if not os.path.isdir(directory):
        print(f"错误：凭证目录 '{directory}' 不存在。")
        return None

    try:
        credential_files = [
            f
            for f in os.listdir(directory)
            if f.startswith("bilibili_credential_") and f.endswith(".json")
        ]
    except OSError as e:
        print(f"错误：无法读取目录 '{directory}'。原因: {e}")
        return None

    if not credential_files:
        print(
            f"错误：在目录 '{directory}' 中没有找到任何 'bilibili_credential_*.json' 文件。"
        )
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
        print(
            f"错误：解析文件 '{latest_file_path}' 失败。请确保文件格式正确。原因: {e}"
        )
        return None
    except OSError as e:
        print(f"错误：读取文件 '{latest_file_path}' 失败。原因: {e}")
        return None


class BilibiliCommentCrawler:
    """B站评论爬虫类"""

    def __init__(self, cookie_data: Dict[str, str] = None, credential_dir: str = None):
        """
        初始化爬虫

        Args:
            cookie_data: 包含cookie信息的字典
            credential_dir: 凭证目录（如果不提供cookie_data时使用）
        """
        self.credential = None

        if cookie_data:
            # 使用传入的cookie数据
            self._load_credentials_from_dict(cookie_data)
        else:
            # 从文件加载凭证（向后兼容）
            if credential_dir is None:
                current_dir = os.path.dirname(os.path.abspath(__file__))
                credential_dir = os.path.join(
                    current_dir, "..", "v1", "bilibili_cookie_output"
                )

            self.credential_dir = credential_dir
            self._load_credentials()

    def _transform_comment_to_simplified_format(self, comment_data: Dict) -> Dict:
        """
        将原始的B站评论数据转换为简化的中文字段格式
        确保与目标格式完全一致

        Args:
            comment_data: 原始的B站评论数据

        Returns:
            转换后的简化格式数据
        """
        # 处理时间戳转换 - 确保格式为 "YYYY-MM-DD HH:MM:SS"
        ctime = comment_data.get("ctime", 0)
        formatted_time = "未知时间"
        if ctime and isinstance(ctime, (int, float)):
            try:
                # 将时间戳转换为目标文件所需的格式
                dt = datetime.datetime.fromtimestamp(ctime)
                formatted_time = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception as e:
                print(f"时间戳转换失败: {ctime}, 错误: {e}")
                formatted_time = "未知时间"

        # 获取父评论ID - 确保数据类型正确
        parent_id = 0
        if comment_data.get("parent", 0) != 0:
            parent_id = int(comment_data.get("parent", 0))
        elif comment_data.get("root", 0) != 0:
            parent_id = int(comment_data.get("root", 0))

        # 安全获取用户名
        username = "未知用户"
        member_info = comment_data.get("member", {})
        if isinstance(member_info, dict):
            username = member_info.get("uname", "未知用户")

        # 安全获取评论内容
        content_text = ""
        content_info = comment_data.get("content", {})
        if isinstance(content_info, dict):
            content_text = content_info.get("message", "")

        # 构建简化格式 - 确保字段顺序和类型与目标一致
        simplified_comment = {
            "评论ID": int(comment_data.get("rpid", 0)),
            "用户名": str(username),
            "评论内容": str(content_text),
            "点赞数": int(comment_data.get("like", 0)),
            "回复时间": formatted_time,
            "父评论ID": parent_id,
            "replies": [],
        }

        # 递归处理子评论
        replies_data = comment_data.get("replies", [])
        if replies_data and isinstance(replies_data, list):
            for reply in replies_data:
                if isinstance(reply, dict):
                    simplified_reply = self._transform_comment_to_simplified_format(
                        reply
                    )
                    simplified_comment["replies"].append(simplified_reply)

        return simplified_comment

    def _load_credentials_from_dict(self, cookie_data: Dict[str, str]):
        """从字典加载凭证"""
        try:
            self.credential = BiliCredential(
                sessdata=cookie_data.get("sessdata", ""),
                bili_jct=cookie_data.get("bili_jct", ""),
                buvid3=cookie_data.get("buvid3", ""),
                dedeuserid=cookie_data.get("dedeuserid", ""),
                ac_time_value=cookie_data.get("ac_time_value", ""),
            )
            print("从传入数据加载凭证成功！")
        except Exception as e:
            raise Exception(f"从传入数据加载凭证失败: {e}")

    def _load_credentials(self):
        """从文件加载凭证"""
        credential_data = load_latest_credential(self.credential_dir)
        if not credential_data:
            raise Exception("凭证加载失败，无法初始化爬虫")

        self.credential = BiliCredential(
            sessdata=credential_data.sessdata,
            bili_jct=credential_data.bili_jct,
            buvid3=credential_data.buvid3,
            dedeuserid=credential_data.dedeuserid,
            ac_time_value=credential_data.ac_time_value,
        )

    def _validate_bv_id(self, bv_id: str) -> bool:
        """
        验证BV号格式是否正确

        Args:
            bv_id: 输入的BV号

        Returns:
            bool: True表示格式正确，False表示格式错误
        """
        # === BV号追踪日志 - 验证函数内部 ===
        print(
            f"🔍 [BV验证] 接收的原始BV号: '{bv_id}' (类型: {type(bv_id)}, 长度: {len(bv_id)})"
        )

        # 检查基本格式：去除空格后检查
        trimmed_bv_id = bv_id.strip()
        print(f"🔍 [BV验证] 去除空格后: '{trimmed_bv_id}' (长度: {len(trimmed_bv_id)})")

        # 验证BV号格式 - 不区分大小写
        if not trimmed_bv_id.upper().startswith("BV") or len(trimmed_bv_id) != 12:
            print(f"❌ [BV验证] 格式验证失败: 不以BV开头或长度不是12")
            print(
                f"   - startswith('BV') (忽略大小写): {trimmed_bv_id.upper().startswith('BV')}"
            )
            print(f"   - 长度: {len(trimmed_bv_id)} (期望: 12)")
            return False

        # 验证BV号字符组成 - 不区分大小写
        import re

        if not re.match(r"^[Bb][Vv][a-zA-Z0-9]{10}$", trimmed_bv_id):
            print(f"❌ [BV验证] 字符组成验证失败: 包含非法字符")
            print(f"   - BV号: '{trimmed_bv_id}'")
            print(
                f"   - 正则匹配结果: {re.match(r'^[Bb][Vv][a-zA-Z0-9]{10}$', trimmed_bv_id) is not None}"
            )
            return False

        print(f"✅ [BV验证] BV号格式验证通过: '{bv_id}' (保持原始格式)")
        return True

    async def get_all_sub_comments(self, oid: int, rpid: int) -> List[Dict]:
        """异步获取一个根评论下的所有子评论（回复）"""
        sub_comments = []
        page_num = 1

        c_obj = comment.Comment(
            oid=oid,
            type_=comment.CommentResourceType.VIDEO,
            rpid=rpid,
            credential=self.credential,
        )

        while True:
            try:
                sub_comment_data = await c_obj.get_sub_comments(
                    page_index=page_num, page_size=10
                )

                if not sub_comment_data or not sub_comment_data.get("replies"):
                    break

                sub_comments.extend(sub_comment_data["replies"])

                if len(sub_comments) >= sub_comment_data["page"]["count"]:
                    break

                page_num += 1
                await asyncio.sleep(random.uniform(0.5, 1.0))

            except Exception as e:
                print(f"  [!] 获取 rpid={rpid} 的子评论时在第 {page_num} 页出错: {e}")
                break

        return sub_comments

    async def crawl_comments(
        self, bv_id: str, save_dir: str = None, progress_callback=None
    ) -> Dict[str, Any]:
        """
        爬取指定BV号视频的评论，通过两阶段构建精确的树形结构并保存为JSON文件。
        第一阶段：获取所有评论到一个字典中。
        第二阶段：根据父子关系构建树，并彻底修正孤儿评论。

        Args:
            bv_id: B站视频BV号
            save_dir: 保存目录
            progress_callback: 进度回调函数

        Returns:
            包含结果信息的字典
        """
        if not self._validate_bv_id(bv_id):
            return {"error": f"无效的BV号格式: {bv_id}", "status": "failed"}

        bv_id = bv_id.strip()
        v = video.Video(bvid=bv_id, credential=self.credential)
        comment_map = {}  # 使用字典存储所有评论，以rpid为键，自动处理重复

        if progress_callback:
            progress_callback("开始获取视频信息...")

        try:
            video_aid = v.get_aid()
            info = await v.get_info()
            print(f"视频信息获取成功: AID={video_aid}, 标题={info['title']}")

            # --- STAGE 1: 获取所有评论 ---
            if progress_callback:
                progress_callback("正在获取所有评论...")

            page_num = 1
            while True:
                print(f"正在获取第 {page_num} 页主评论及其所有子评论...")
                if progress_callback:
                    progress_callback(f"正在获取第 {page_num} 页...")

                main_comments_page = await comment.get_comments(
                    oid=video_aid,
                    type_=comment.CommentResourceType.VIDEO,
                    page_index=page_num,
                    credential=self.credential,
                )

                if not main_comments_page or not main_comments_page.get("replies"):
                    print("已获取所有主评论页面。")
                    break

                page_replies = main_comments_page.get("replies", [])
                for p_comment in page_replies:
                    comment_map[p_comment["rpid"]] = p_comment

                    if p_comment.get("rcount", 0) > 0:
                        sub_comments = await self.get_all_sub_comments(
                            video_aid, p_comment["rpid"]
                        )
                        for sub in sub_comments:
                            comment_map[sub["rpid"]] = sub

                page_num += 1
                await asyncio.sleep(random.uniform(1.0, 2.5))

            total_raw_comments = len(comment_map)
            print(f"✅ 获取阶段完成，共获得 {total_raw_comments} 条独立评论。")
            if progress_callback:
                progress_callback(
                    f"获取完成，共 {total_raw_comments} 条，开始构建评论树..."
                )

            # --- STAGE 2: 从MAP构建正确的树形结构 ---
            print("🔄 开始根据父子关系构建精确的评论树...")
            for c_obj in comment_map.values():
                c_obj["replies"] = []

            comment_trees = []
            for c_obj in comment_map.values():
                parent_id = c_obj.get("parent", 0)
                if parent_id == 0:
                    comment_trees.append(c_obj)
                else:
                    parent_obj = comment_map.get(parent_id)
                    if parent_obj:
                        parent_obj["replies"].append(c_obj)
                    else:
                        # [!!!] 终极修正 [!!!]
                        # 当评论的父评论找不到时（孤儿评论），必须同时将它的 parent 和 root 都设为0
                        # 这样才能确保格式转换函数能正确地将其识别为顶层评论
                        print(
                            f"⚠️ 警告: 评论 rpid={c_obj['rpid']} 的父评论 rpid={parent_id} 未找到。正在将其修正为顶层评论。"
                        )
                        c_obj["parent"] = 0
                        c_obj["root"] = 0  # <--- 这就是最关键的补充修正！
                        comment_trees.append(c_obj)

            print("✅ 评论树结构构建完成。")

            if not comment_trees:
                return {"error": "未能获取到任何评论", "status": "failed"}

            # --- STAGE 3: 转换数据格式并保存 ---
            if progress_callback:
                progress_callback("转换数据格式...")

            print("🔄 开始将评论树转换为目标JSON格式...")
            comment_trees.sort(key=lambda x: x["rpid"], reverse=True)
            simplified_comments = [
                self._transform_comment_to_simplified_format(tree_node)
                for tree_node in comment_trees
            ]
            print("✅ 格式转换完成。")

            title = re.sub(r'[\\/:"*?<>|]', "_", info["title"])
            filename = f"{title}_comments.json"
            save_dir = save_dir or os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "output"
            )
            os.makedirs(save_dir, exist_ok=True)
            save_path = os.path.join(save_dir, filename)

            print(f"💾 正在保存到: {save_path}")
            with open(save_path, "w", encoding="utf-8") as jsonfile:
                json.dump(simplified_comments, jsonfile, ensure_ascii=False, indent=2)

            result = {
                "file_path": save_path,
                "video_title": info["title"],
                "bv_id": bv_id,
                "total_comments": len(comment_map),
            }

            if progress_callback:
                progress_callback("爬取完成！")

            print(f"\n爬取完成！评论已保存到文件：{save_path}")
            return result

        except Exception as e:
            error_msg = f"在处理评论时发生严重错误: {str(e)}"
            print(f"[!!] {error_msg}")
            import traceback

            traceback.print_exc()
            return {
                "error": error_msg,
                "error_type": type(e).__name__,
                "status": "failed",
            }


# 便捷函数
async def crawl_bilibili_comments(
    bv_id: str,
    cookie_data: Dict[str, str] = None,
    save_dir: str = None,
    credential_dir: str = None,
    progress_callback=None,
) -> Dict[str, Any]:
    """
    便捷的爬取函数

    Args:
        bv_id: B站视频BV号
        cookie_data: Cookie数据字典
        save_dir: 保存目录
        credential_dir: 凭证目录（如果不提供cookie_data时使用）
        progress_callback: 进度回调函数

    Returns:
        包含结果信息的字典
    """
    crawler = BilibiliCommentCrawler(cookie_data, credential_dir)

    # === BV号追踪日志 - 爬虫便捷函数层 ===
    print(
        f"🔍 [爬虫便捷函数] 接收的BV号: '{bv_id}' (类型: {type(bv_id)}, 长度: {len(bv_id)})"
    )
    print(f"🔍 [爬虫便捷函数] 即将传递给crawler.crawl_comments的BV号: '{bv_id}'")

    return await crawler.crawl_comments(bv_id, save_dir, progress_callback)


if __name__ == "__main__":
    # 测试代码
    async def test():
        result = await crawl_bilibili_comments("BV1AngkzKEVn")
        print("测试结果:", result)

    asyncio.run(test())
