"""测试脚本：修改 URL 和 DOM 变量，直接运行"""

from gen_config import call_doubao, domain_to_filename, fix_url_mode, CONFIG_DIR
from urllib.parse import urlparse
import json

# ═══════════════════════════════════════════════════════════
# 👇 修改这两个变量
# ═══════════════════════════════════════════════════════════

URL = "https://www.workatastartup.com/companies?demographic=any&hasEquity=any&hasSalary=any&industry=any&interviewProcess=any&jobType=intern&layout=list-compact&role=eng&sortBy=created_desc&tab=any&usVisaNotRequired=any"

DOM = """
<div class="jobs-list">
    <div>
        <div class="w-full bg-beige-lighter mb-2 rounded-md p-2 border border-gray-200 flex"><a target="company"
                href="https://www.workatastartup.com/companies/varos">
                <div class="company-logo round-logo-wrapper fullscreen-only"><span class="helper"><img alt="Varos"
                            class="logo"
                            src="https://bookface-images.s3.amazonaws.com/small_logos/1d8d1d12eabe00614dddbb8b85a798561bc42d4d.png"
                            style="max-width:70px;"></span></div>
            </a>
            <div class="ml-5 my-auto grow">
                <div class="company-details text-lg"><a target="company"
                        href="https://www.workatastartup.com/companies/varos"><span class="font-bold">Varos&nbsp;(S21)
                        </span><span class="separator hidden sm:inline-block sm:mx-1">• </span><span
                            class="text-gray-600 block sm:inline">AI Business Analysts to gather requirements and
                            optimize processes</span><span
                            class="text-gray-300 text-sm block sm:inline ml-0 sm:ml-2 mt-1 sm:mt-0">(about 19 hours
                            ago)</span></a></div>
                <div class="flex-none sm:flex mt-2 flex-wrap">
                    <div class="job-name shrink text-blue-500"><a data-jobid="89594" class="font-bold captialize mr-5"
                            target="job" href="https://www.workatastartup.com/jobs/89594">Senior Full Stack Engineer</a>
                    </div>
                    <p class="job-details my-auto break-normal"><span
                            class="capitalize text-sm font-thin">fulltime</span><span
                            class="before:inline-block before:content-[''] before:mx-3 before:my-auto before:text-xs before:px-1 before:w-2 before:h-2 before:rounded-md before:bg-gray-700 capitalize text-sm font-thin">Tel
                            Aviv-Yafo, Tel Aviv District, IL / New York, NY, US / Remote (US)</span><span
                            class="before:inline-block before:content-[''] before:mx-3 before:my-auto before:text-xs before:px-1 before:w-2 before:h-2 before:rounded-md before:bg-gray-700 capitalize text-sm font-thin">Full
                            stack</span></p>
                </div>
            </div>
            <div class="my-auto ml-5 hidden sm:block"><a data-jobid="89594"
                    class="inline-flex items-center px-2.5 py-1.5 border border-transparent font-medium rounded shadow-xs text-white bg-orange-500 hover:bg-orange-600 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 text-center"
                    target="_blank"
                    href="https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D89594&amp;defaults%5BsignUpActive%5D=true&amp;defaults%5Bwaas_company%5D=23967">Apply</a>
            </div>
        </div>
    </div>
    <div>
        <div class="w-full bg-beige-lighter mb-2 rounded-md p-2 border border-gray-200 flex"><a target="company"
                href="https://www.workatastartup.com/companies/pocketsuite">
                <div class="company-logo round-logo-wrapper fullscreen-only"><span class="helper"><img alt="PocketSuite"
                            class="logo"
                            src="https://bookface-images.s3.amazonaws.com/small_logos/cdb97ca4207ccb8346f6dd29984f5fca487812e0.png"
                            style="max-width:70px;"></span></div>
            </a>
            <div class="ml-5 my-auto grow">
                <div class="company-details text-lg"><a target="company"
                        href="https://www.workatastartup.com/companies/pocketsuite"><span
                            class="font-bold">PocketSuite&nbsp;(W16) </span><span
                            class="separator hidden sm:inline-block sm:mx-1">• </span><span
                            class="text-gray-600 block sm:inline">PocketSuite makes it easy for your clients to book and
                            pay you</span><span
                            class="text-gray-300 text-sm block sm:inline ml-0 sm:ml-2 mt-1 sm:mt-0">(10 days
                            ago)</span></a></div>
                <div class="flex-none sm:flex mt-2 flex-wrap">
                    <div class="job-name shrink text-blue-500"><a data-jobid="1084" class="font-bold captialize mr-5"
                            target="job" href="https://www.workatastartup.com/jobs/1084">Lead Generalist Engineer</a>
                    </div>
                    <p class="job-details my-auto break-normal"><span
                            class="capitalize text-sm font-thin">fulltime</span><span
                            class="before:inline-block before:content-[''] before:mx-3 before:my-auto before:text-xs before:px-1 before:w-2 before:h-2 before:rounded-md before:bg-gray-700 capitalize text-sm font-thin">US
                            / Remote (US)</span><span
                            class="before:inline-block before:content-[''] before:mx-3 before:my-auto before:text-xs before:px-1 before:w-2 before:h-2 before:rounded-md before:bg-gray-700 capitalize text-sm font-thin">Full
                            stack</span></p>
                </div>
            </div>
            <div class="my-auto ml-5 hidden sm:block"><a data-jobid="1084"
                    class="inline-flex items-center px-2.5 py-1.5 border border-transparent font-medium rounded shadow-xs text-white bg-orange-500 hover:bg-orange-600 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 text-center"
                    target="_blank"
                    href="https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D1084&amp;defaults%5BsignUpActive%5D=true&amp;defaults%5Bwaas_company%5D=1018">Apply</a>
            </div>
        </div>
    </div>
</div>
"""

# ═══════════════════════════════════════════════════════════


def main():
    raw_config = call_doubao(DOM, URL)

    try:
        config = json.loads(raw_config)
    except json.JSONDecodeError as e:
        print(f"JSON 解析失败: {e}")
        print(f"原始返回:\n{raw_config}")
        return

    config = fix_url_mode(config, DOM)
    config["domain"] = urlparse(URL).netloc.lower()

    CONFIG_DIR.mkdir(exist_ok=True)
    filename = domain_to_filename(config["domain"])
    output_path = CONFIG_DIR / filename
    output_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n配置文件已生成: {output_path}\n")
    print(json.dumps(config, ensure_ascii=False, indent=2))
    print(f'\n验证: python run.py "{URL}"')


if __name__ == "__main__":
    main()
